/**
 * Fiscal Period Close & Reopen Domain Service (docs/FINANCE-PLAN.md §3.9).
 *
 * Implements:
 * 1. listFiscalPeriods: returns closed periods, current closedThrough timestamp, and closable months.
 * 2. closeFiscalPeriod: closes a finished month, stores live P&L snapshot, invalidates closedThrough cache, logs audit.
 * 3. reopenFiscalPeriod: reopens the newest closed month, invalidates cache, logs audit.
 */

import { and, desc, eq } from "drizzle-orm";
import { schema, withTenant, type DbHandle } from "@bs/db";
import { assertPermission, type TenantContext } from "../context.ts";
import { getClosedThrough, invalidateClosedPeriodCache } from "./ledger.ts";
import { getProfitAndLoss, getDistinctCurrencies } from "./reports.ts";

export async function listFiscalPeriods(
  dbRw: DbHandle,
  ctx: TenantContext,
) {
  assertPermission(ctx, "finance.read");

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.fiscalPeriods)
      .where(eq(schema.fiscalPeriods.tenantId, ctx.tenantId))
      .orderBy(desc(schema.fiscalPeriods.label));

    const closedThrough = await getClosedThrough(tx, ctx.tenantId);

    // Closable months: last 36 finished calendar months minus already closed ones
    const now = new Date();
    const currentMonthLabel = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const closedLabels = new Set(rows.map((r) => r.label));

    const closableMonths: string[] = [];
    for (let i = 1; i <= 36; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      if (label < currentMonthLabel && !closedLabels.has(label)) {
        closableMonths.push(label);
      }
    }

    return {
      items: rows.map((r) => ({
        id: r.id,
        label: r.label,
        closedAt: r.closedAt.toISOString(),
        closedByUserId: r.closedBy,
        note: r.note,
        snapshot: (r.snapshot as Record<string, unknown>) ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      closedThrough: closedThrough ? closedThrough.toISOString() : null,
      closableMonths,
    };
  });
}

export async function closeFiscalPeriod(
  dbRw: DbHandle,
  ctx: TenantContext,
  opts: { label: string; note?: string | undefined },
) {
  assertPermission(ctx, "finance.write");

  const [yearStr = "", monthStr = ""] = opts.label.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10); // 1-12

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    throw new Error("Bad Request: Invalid fiscal period label format (expected YYYY-MM)");
  }

  // End of month instant in UTC
  const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));

  const now = new Date();
  if (periodEnd.getTime() > now.getTime()) {
    throw new Error("Bad Request: Cannot close an ongoing or future month");
  }

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    // Check if already closed
    const [existing] = await tx
      .select({ id: schema.fiscalPeriods.id })
      .from(schema.fiscalPeriods)
      .where(
        and(
          eq(schema.fiscalPeriods.tenantId, ctx.tenantId),
          eq(schema.fiscalPeriods.label, opts.label),
        ),
      )
      .limit(1);

    if (existing) {
      throw new Error(`Conflict: Fiscal period ${opts.label} is already closed`);
    }

    // Compute live P&L snapshot for the closed period
    const currencies = await getDistinctCurrencies(dbRw, ctx);
    const pnlSnapshots: Record<string, unknown> = {};
    for (const curr of currencies) {
      pnlSnapshots[curr] = await getProfitAndLoss(tx, ctx.tenantId, periodStart, periodEnd, curr);
    }

    const userId = ctx.actor.type === "staff" ? ctx.actor.userId : "00000000-0000-0000-0000-000000000000";
    const [row] = await tx
      .insert(schema.fiscalPeriods)
      .values({
        tenantId: ctx.tenantId,
        periodFrom: periodStart.toISOString().slice(0, 10),
        periodTo: periodEnd.toISOString().slice(0, 10),
        label: opts.label,
        closedAt: periodEnd,
        closedBy: userId,
        note: opts.note ?? null,
        snapshot: pnlSnapshots,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to close fiscal period");
    }

    // Invalidate closedThrough cache immediately
    invalidateClosedPeriodCache(ctx.tenantId);

    // Write audit log (rule 6)
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "finance.period_closed",
      targetType: "fiscal_period",
      targetId: row.id,
      diff: {
        label: opts.label,
        closedAt: periodEnd.toISOString(),
        note: opts.note ?? null,
      },
    });

    return {
      id: row.id,
      label: row.label,
      closedAt: row.closedAt.toISOString(),
      closedByUserId: row.closedBy,
      note: row.note,
      snapshot: (row.snapshot as Record<string, unknown>) ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function reopenFiscalPeriod(
  dbRw: DbHandle,
  ctx: TenantContext,
  opts: { label: string; reason: string },
) {
  assertPermission(ctx, "finance.write");

  if (!opts.reason || opts.reason.trim().length < 4 || opts.reason.trim().length > 500) {
    throw new Error("Bad Request: Reopen reason must be between 4 and 500 characters");
  }

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    // Only the newest closed month can be reopened
    const [latestClosed] = await tx
      .select()
      .from(schema.fiscalPeriods)
      .where(eq(schema.fiscalPeriods.tenantId, ctx.tenantId))
      .orderBy(desc(schema.fiscalPeriods.label))
      .limit(1);

    if (!latestClosed) {
      throw new Error("Bad Request: No closed periods found to reopen");
    }

    if (latestClosed.label !== opts.label) {
      throw new Error(`Bad Request: Only the newest closed period (${latestClosed.label}) can be reopened`);
    }

    await tx
      .delete(schema.fiscalPeriods)
      .where(
        and(
          eq(schema.fiscalPeriods.tenantId, ctx.tenantId),
          eq(schema.fiscalPeriods.id, latestClosed.id),
        ),
      );

    // Invalidate cache
    invalidateClosedPeriodCache(ctx.tenantId);

    // Write audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "finance.period_reopened",
      targetType: "fiscal_period",
      targetId: latestClosed.id,
      diff: {
        reopenedLabel: opts.label,
        reason: opts.reason.trim(),
      },
    });

    return { reopenedLabel: opts.label };
  });
}
