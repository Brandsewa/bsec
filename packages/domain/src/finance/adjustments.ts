/**
 * Finance Adjustments Service (docs/FINANCE-PLAN.md §3.8).
 *
 * Implements:
 * 1. listAdjustments: Lists ledger entries where sourceKind = 'adjustment', newest first.
 * 2. createAdjustment: Creates a strict, balanced manual adjustment with audit logging.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { schema, withTenant, type DbHandle } from "@bs/db";
import { assertPermission, type TenantContext } from "../context.ts";
import {
  LEDGER_ACCOUNTS,
  LEDGER_BOOK,
  type LedgerAccount,
} from "./accounts.ts";
import {
  postLedgerEntries,
  postingKey,
  type LedgerPosting,
} from "./ledger.ts";

export interface CreateAdjustmentOptions {
  date: string; // YYYY-MM-DD or ISO
  accountDebit: string;
  accountCredit: string;
  amount: number; // in paise
  currency?: string;
  reason: string;
}

export async function listAdjustments(
  dbRw: DbHandle,
  ctx: TenantContext,
  opts: { limit?: number; offset?: number } = {},
) {
  assertPermission(ctx, "finance.read");
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    const whereClause = and(
      eq(schema.ledgerEntries.tenantId, ctx.tenantId),
      eq(schema.ledgerEntries.sourceKind, "adjustment"),
    );

    const [countRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.ledgerEntries)
      .where(whereClause);

    const rows = await tx
      .select()
      .from(schema.ledgerEntries)
      .where(whereClause)
      .orderBy(desc(schema.ledgerEntries.date), desc(schema.ledgerEntries.createdAt))
      .limit(limit)
      .offset(offset);

    const items = rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      book: r.book,
      accountDebit: r.debit,
      accountCredit: r.credit,
      amount: Number(r.amount),
      currency: r.currency,
      sourceKind: r.sourceKind,
      sourceId: r.sourceId,
      reason: r.sourceRef, // We store reason in sourceRef and note
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }));

    return {
      items,
      total: countRow?.count ?? 0,
    };
  });
}

export async function createAdjustment(
  dbRw: DbHandle,
  ctx: TenantContext,
  opts: CreateAdjustmentOptions,
) {
  assertPermission(ctx, "finance.write");

  if (!opts.reason || opts.reason.trim().length < 4 || opts.reason.trim().length > 500) {
    throw new Error("Bad Request: adjustment reason must be between 4 and 500 characters");
  }

  if (!opts.amount || opts.amount <= 0 || !Number.isInteger(opts.amount)) {
    throw new Error("Bad Request: adjustment amount must be a positive integer in paise");
  }

  const known = LEDGER_ACCOUNTS as readonly string[];
  if (!known.includes(opts.accountDebit) || !known.includes(opts.accountCredit)) {
    throw new Error("Bad Request: adjustment accounts must be accounts from the store's chart of accounts");
  }

  if (Number.isNaN(new Date(opts.date.length === 10 ? `${opts.date}T00:00:00.000Z` : opts.date).getTime())) {
    throw new Error("Bad Request: adjustment date is not a valid date");
  }

  if (opts.accountDebit === opts.accountCredit) {
    throw new Error("Bad Request: debit and credit accounts must be different");
  }

  const currency = (opts.currency ?? "INR").toUpperCase();
  const date = new Date(opts.date.length === 10 ? `${opts.date}T00:00:00.000Z` : opts.date);
  const adjustmentId = crypto.randomUUID();

  // Create posting with deterministic unique key
  const posting: LedgerPosting = {
    date,
    book: LEDGER_BOOK.OWN,
    debit: opts.accountDebit as LedgerAccount,
    credit: opts.accountCredit as LedgerAccount,
    amount: opts.amount,
    currency,
    source: {
      kind: "adjustment",
      id: adjustmentId,
      ref: opts.reason.trim(),
    },
    key: postingKey("adjustment", adjustmentId, date.toISOString().slice(0, 10)),
    note: opts.reason.trim(),
  };

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    // 1. Post ledger entries strictly (throws on error/period close conflict)
    await postLedgerEntries(tx, ctx.tenantId, [posting], { strict: true });

    // 2. Fetch the newly created entry
    const [entry] = await tx
      .select()
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.tenantId, ctx.tenantId),
          eq(schema.ledgerEntries.sourceKind, "adjustment"),
          eq(schema.ledgerEntries.sourceId, adjustmentId),
        ),
      )
      .limit(1);

    if (!entry) {
      throw new Error("Failed to retrieve created adjustment entry");
    }

    // 3. Insert audit log row (rule 6: money changed, so audit is mandatory)
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "finance.adjustment_created",
      targetType: "ledger_entry",
      targetId: entry.id,
      diff: {
        adjustmentId,
        accountDebit: opts.accountDebit,
        accountCredit: opts.accountCredit,
        amount: opts.amount,
        currency,
        reason: opts.reason.trim(),
        date: opts.date,
      },
    });

    return {
      id: entry.id,
      date: entry.date.toISOString().slice(0, 10),
      book: entry.book,
      accountDebit: entry.debit,
      accountCredit: entry.credit,
      amount: Number(entry.amount),
      currency: entry.currency,
      sourceKind: entry.sourceKind,
      sourceId: entry.sourceId,
      reason: entry.sourceRef,
      note: entry.note,
      createdAt: entry.createdAt.toISOString(),
    };
  });
}
