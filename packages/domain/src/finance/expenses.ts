/**
 * Store Expenses Domain Service (docs/FINANCE-PLAN.md §3.7).
 *
 * Implements:
 * 1. listExpenses: paged list, period filter, category & paidFrom filters, search, totals.
 * 2. createExpense: creates expense row, posts ledger entries strictly, writes audit log.
 * 3. updateExpense: updates expense, bumps revision, reverses old ledger entry, posts new strictly, writes audit log.
 * 4. deleteExpense: posts reversal of active revision strictly, then deletes row, writes audit log.
 * 5. settleExpense: settles unpaid bill (paid_from = 'unpaid'), posts settlement strictly, updates row, writes audit log.
 * 6. unsettleExpense: reverses settlement strictly, resets settlement on row, writes audit log.
 * 7. materializeRecurringExpenses: catch-up due recurring template copies (<= 12 per tick).
 */

import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { schema, withTenant, type DbHandle } from "@bs/db";
import { addRecurringInterval, firstRecurringDue, type RecurringInterval, type ExpenseItem } from "@bs/contracts";
import { assertPermission, type TenantContext } from "../context.ts";
import { resolvePeriod } from "./period-resolution.ts";
import {
  expensePostings,
  expenseSettlementPostings,
} from "./postings.ts";
import { postLedgerEntries } from "./ledger.ts";

export interface ListExpensesFilter {
  period?: ("7d" | "30d" | "90d" | "ytd" | "all") | undefined;
  from?: string | undefined;
  to?: string | undefined;
  category?: string | undefined;
  paidFrom?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateExpenseOptions {
  date: string; // YYYY-MM-DD
  amount: number; // in paise
  currency?: string | undefined;
  category: string;
  paidFrom: "cash_bank" | "cash_gateway" | "cash_on_hand" | "unpaid";
  payee?: string | undefined;
  note?: string | undefined;
  receiptMediaId?: string | undefined;
  recurring?: {
    enabled: boolean;
    interval: "monthly" | "quarterly" | "yearly";
    intervalCount?: number | undefined;
    endsAt?: string | undefined;
    backfillDue?: boolean | undefined;
  } | undefined;
}

export interface UpdateExpenseOptions {
  id: string;
  date?: string | undefined;
  amount?: number | undefined;
  category?: string | undefined;
  paidFrom?: ("cash_bank" | "cash_gateway" | "cash_on_hand" | "unpaid") | undefined;
  payee?: string | null | undefined;
  note?: string | null | undefined;
  receiptMediaId?: string | null | undefined;
}

export interface SettleExpenseOptions {
  id: string;
  settledAt: string; // ISO date YYYY-MM-DD
  paidFrom: "cash_bank" | "cash_gateway" | "cash_on_hand";
  note?: string | undefined;
}

export async function listExpenses(
  dbRw: DbHandle,
  ctx: TenantContext,
  opts: ListExpensesFilter = {},
) {
  assertPermission(ctx, "finance.read");
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);

  const resolution = resolvePeriod({
    named: opts.period,
    from: opts.from,
    to: opts.to,
  });

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    const conditions = [
      eq(schema.expenses.tenantId, ctx.tenantId),
      gte(schema.expenses.date, resolution.from.toISOString().slice(0, 10)),
      lte(schema.expenses.date, resolution.to.toISOString().slice(0, 10)),
    ];

    if (opts.category) {
      conditions.push(eq(schema.expenses.category, opts.category));
    }
    if (opts.paidFrom) {
      conditions.push(eq(schema.expenses.paidFrom, opts.paidFrom));
    }
    if (opts.search && opts.search.trim().length > 0) {
      const q = `%${opts.search.trim()}%`;
      const orFilter = or(
        ilike(schema.expenses.description, q),
        ilike(schema.expenses.payee, q),
        ilike(schema.expenses.note, q),
      );
      if (orFilter) conditions.push(orFilter);
    }

    const whereClause = and(...conditions);

    const [countRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.expenses)
      .where(whereClause);

    // Filtered period total
    const [periodTotalRow] = await tx
      .select({ total: sql<string>`COALESCE(SUM(${schema.expenses.amount}), 0)` })
      .from(schema.expenses)
      .where(whereClause);

    // All-time unpaid total
    const [unpaidRow] = await tx
      .select({ total: sql<string>`COALESCE(SUM(${schema.expenses.amount}), 0)` })
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.tenantId, ctx.tenantId),
          eq(schema.expenses.paidFrom, "unpaid"),
          isNull(schema.expenses.settlement),
        ),
      );

    const rows = await tx
      .select()
      .from(schema.expenses)
      .where(whereClause)
      .orderBy(desc(schema.expenses.date), desc(schema.expenses.createdAt))
      .limit(limit)
      .offset(offset);

    const items: ExpenseItem[] = rows.map((r) => ({
      id: r.id,
      templateId: r.templateId,
      number: `EXP-${r.id.slice(0, 8).toUpperCase()}`,
      date: r.date,
      amount: Number(r.amount),
      currency: r.currency,
      category: r.category,
      paidFrom: r.paidFrom,
      payee: r.payee,
      note: r.note,
      receiptMediaId: r.receiptMediaId,
      settlement: r.settlement as ExpenseItem["settlement"],
      recurring: r.recurring as ExpenseItem["recurring"],
      revision: r.revision,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    return {
      items,
      total: countRow?.count ?? 0,
      periodTotalPaise: Number(periodTotalRow?.total ?? 0),
      allTimeUnpaidPaise: Number(unpaidRow?.total ?? 0),
    };
  });
}

export async function createExpense(
  dbRw: DbHandle,
  ctx: TenantContext,
  opts: CreateExpenseOptions,
) {
  assertPermission(ctx, "finance.write");

  if (!opts.amount || opts.amount <= 0 || !Number.isInteger(opts.amount)) {
    throw new Error("Bad Request: Expense amount must be a positive integer in paise");
  }

  const currency = (opts.currency ?? "INR").toUpperCase();
  const dateStr = opts.date.slice(0, 10);
  const expenseId = crypto.randomUUID();
  const description = opts.payee
    ? `${opts.category.replace(/_/g, " ")} - ${opts.payee}`
    : opts.category.replace(/_/g, " ");

  const recurringData = opts.recurring?.enabled
    ? {
        enabled: true,
        interval: opts.recurring.interval,
        intervalCount: opts.recurring.intervalCount ?? 1,
        // The first copy is one interval after this expense. Unless the merchant asked to backfill periods
        // that are already past, start from the first interval that is still in the future.
        nextDueAt: firstDueFrom(dateStr, opts.recurring.interval, opts.recurring.intervalCount ?? 1, opts.recurring.backfillDue === true).toISOString(),
        endsAt: opts.recurring.endsAt ?? null,
      }
    : null;

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    // 1. Post ledger entry strictly (throws on conflict or closed period)
    const postings = expensePostings({
      expense: {
        id: expenseId,
        date: dateStr,
        category: opts.category,
        amount: opts.amount,
        currency,
        description,
        payee: opts.payee ?? null,
        paidFrom: opts.paidFrom,
        revision: 0,
      },
    });

    await postLedgerEntries(tx, ctx.tenantId, postings, { strict: true });

    // 2. Insert expense row
    const userId = ctx.actor.type === "staff" ? ctx.actor.userId : "00000000-0000-0000-0000-000000000000";
    const [row] = await tx
      .insert(schema.expenses)
      .values({
        id: expenseId,
        tenantId: ctx.tenantId,
        date: dateStr,
        category: opts.category,
        amount: opts.amount,
        currency,
        description,
        payee: opts.payee ?? null,
        paidFrom: opts.paidFrom,
        receiptMediaId: opts.receiptMediaId ?? null,
        recurring: recurringData,
        note: opts.note ?? null,
        revision: 0,
        createdBy: userId,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to insert expense row");
    }

    // 3. Write audit log (rule 6)
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "finance.expense_created",
      targetType: "expense",
      targetId: row.id,
      diff: {
        amount: opts.amount,
        currency,
        category: opts.category,
        paidFrom: opts.paidFrom,
        payee: opts.payee ?? null,
      },
    });

    return {
      id: row.id,
      templateId: row.templateId,
      number: `EXP-${row.id.slice(0, 8).toUpperCase()}`,
      date: row.date,
      amount: Number(row.amount),
      currency: row.currency,
      category: row.category,
      paidFrom: row.paidFrom,
      payee: row.payee,
      note: row.note,
      receiptMediaId: row.receiptMediaId,
      settlement: row.settlement as ExpenseItem["settlement"],
      recurring: row.recurring as ExpenseItem["recurring"],
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function updateExpense(
  dbRw: DbHandle,
  ctx: TenantContext,
  opts: UpdateExpenseOptions,
) {
  assertPermission(ctx, "finance.write");

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.tenantId, ctx.tenantId),
          eq(schema.expenses.id, opts.id),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error("Not Found: Expense not found");
    }

    if (existing.settlement) {
      throw new Error("Bad Request: Settled expenses cannot be edited. Unsettle first.");
    }

    const nextRevision = existing.revision + 1;
    const newAmount = opts.amount !== undefined ? opts.amount : Number(existing.amount);
    const newCategory = opts.category !== undefined ? opts.category : existing.category;
    const newPaidFrom = opts.paidFrom !== undefined ? opts.paidFrom : existing.paidFrom;
    const newDate = opts.date !== undefined ? opts.date.slice(0, 10) : existing.date;
    const newPayee = opts.payee !== undefined ? opts.payee : existing.payee;
    const newDescription = newPayee
      ? `${newCategory.replace(/_/g, " ")} - ${newPayee}`
      : newCategory.replace(/_/g, " ");

    const moneyMoved =
      newAmount !== Number(existing.amount) ||
      newCategory !== existing.category ||
      newPaidFrom !== existing.paidFrom ||
      newDate !== existing.date;

    if (moneyMoved) {
      // 1. Post reversal of the existing revision
      const reversalPostings = expensePostings({
        expense: {
          id: existing.id,
          date: existing.date,
          category: existing.category,
          amount: Number(existing.amount),
          currency: existing.currency,
          description: existing.description,
          payee: existing.payee,
          paidFrom: existing.paidFrom,
          revision: existing.revision,
        },
        isReversal: true,
      });

      // 2. Post new revision
      const newPostings = expensePostings({
        expense: {
          id: existing.id,
          date: newDate,
          category: newCategory,
          amount: newAmount,
          currency: existing.currency,
          description: newDescription,
          payee: newPayee,
          paidFrom: newPaidFrom,
          revision: nextRevision,
        },
      });

      await postLedgerEntries(tx, ctx.tenantId, [...reversalPostings, ...newPostings], {
        strict: true,
      });
    }

    const userId = ctx.actor.type === "staff" ? ctx.actor.userId : null;
    const [updated] = await tx
      .update(schema.expenses)
      .set({
        date: newDate,
        amount: newAmount,
        category: newCategory,
        paidFrom: newPaidFrom,
        payee: newPayee,
        description: newDescription,
        note: opts.note !== undefined ? opts.note : existing.note,
        receiptMediaId: opts.receiptMediaId !== undefined ? opts.receiptMediaId : existing.receiptMediaId,
        revision: moneyMoved ? nextRevision : existing.revision,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.expenses.tenantId, ctx.tenantId),
          eq(schema.expenses.id, opts.id),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error("Failed to update expense");
    }

    // Write audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "finance.expense_updated",
      targetType: "expense",
      targetId: updated.id,
      diff: {
        before: {
          amount: Number(existing.amount),
          category: existing.category,
          paidFrom: existing.paidFrom,
          date: existing.date,
        },
        after: {
          amount: newAmount,
          category: newCategory,
          paidFrom: newPaidFrom,
          date: newDate,
        },
      },
    });

    return {
      id: updated.id,
      templateId: updated.templateId,
      number: `EXP-${updated.id.slice(0, 8).toUpperCase()}`,
      date: updated.date,
      amount: Number(updated.amount),
      currency: updated.currency,
      category: updated.category,
      paidFrom: updated.paidFrom,
      payee: updated.payee,
      note: updated.note,
      receiptMediaId: updated.receiptMediaId,
      settlement: updated.settlement as ExpenseItem["settlement"],
      recurring: updated.recurring as ExpenseItem["recurring"],
      revision: updated.revision,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  });
}

export async function deleteExpense(
  dbRw: DbHandle,
  ctx: TenantContext,
  expenseId: string,
) {
  assertPermission(ctx, "finance.write");

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.tenantId, ctx.tenantId),
          eq(schema.expenses.id, expenseId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error("Not Found: Expense not found");
    }

    // Post reversal of active revision strictly (nothing is deleted if reversal fails)
    const reversalPostings = expensePostings({
      expense: {
        id: existing.id,
        date: existing.date,
        category: existing.category,
        amount: Number(existing.amount),
        currency: existing.currency,
        description: existing.description,
        payee: existing.payee,
        paidFrom: existing.paidFrom,
        revision: existing.revision,
      },
      isReversal: true,
    });

    await postLedgerEntries(tx, ctx.tenantId, reversalPostings, { strict: true });

    await tx
      .delete(schema.expenses)
      .where(
        and(
          eq(schema.expenses.tenantId, ctx.tenantId),
          eq(schema.expenses.id, expenseId),
        ),
      );

    // Audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "finance.expense_deleted",
      targetType: "expense",
      targetId: existing.id,
      diff: {
        amount: Number(existing.amount),
        category: existing.category,
        description: existing.description,
      },
    });

    return { success: true };
  });
}

export async function settleExpense(
  dbRw: DbHandle,
  ctx: TenantContext,
  opts: SettleExpenseOptions,
) {
  assertPermission(ctx, "finance.write");

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.tenantId, ctx.tenantId),
          eq(schema.expenses.id, opts.id),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error("Not Found: Expense not found");
    }

    if (existing.paidFrom !== "unpaid") {
      throw new Error("Bad Request: Only unpaid bills can be settled");
    }

    if (existing.settlement) {
      throw new Error("Bad Request: Expense is already settled");
    }

    const nextSeq = existing.settlementSequence + 1;
    const settledAtStr = opts.settledAt.slice(0, 10);

    // Post settlement strictly
    const postings = expenseSettlementPostings({
      expenseId: existing.id,
      amount: Number(existing.amount),
      sequence: nextSeq,
      paidFrom: opts.paidFrom,
      paidAt: settledAtStr,
      description: existing.description,
      currency: existing.currency,
    });

    await postLedgerEntries(tx, ctx.tenantId, postings, { strict: true });

    const settlementData = {
      settledAt: settledAtStr,
      paidFrom: opts.paidFrom,
      note: opts.note ?? null,
    };

    const [updated] = await tx
      .update(schema.expenses)
      .set({
        settlement: settlementData,
        settlementSequence: nextSeq,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.expenses.tenantId, ctx.tenantId),
          eq(schema.expenses.id, opts.id),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error("Failed to settle expense");
    }

    // Audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "finance.expense_settled",
      targetType: "expense",
      targetId: updated.id,
      diff: {
        settlement: settlementData,
        sequence: nextSeq,
      },
    });

    return {
      id: updated.id,
      templateId: updated.templateId,
      number: `EXP-${updated.id.slice(0, 8).toUpperCase()}`,
      date: updated.date,
      amount: Number(updated.amount),
      currency: updated.currency,
      category: updated.category,
      paidFrom: updated.paidFrom,
      payee: updated.payee,
      note: updated.note,
      receiptMediaId: updated.receiptMediaId,
      settlement: updated.settlement as ExpenseItem["settlement"],
      recurring: updated.recurring as ExpenseItem["recurring"],
      revision: updated.revision,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  });
}

export async function unsettleExpense(
  dbRw: DbHandle,
  ctx: TenantContext,
  expenseId: string,
) {
  assertPermission(ctx, "finance.write");

  return withTenant(dbRw.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.tenantId, ctx.tenantId),
          eq(schema.expenses.id, expenseId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error("Not Found: Expense not found");
    }

    if (!existing.settlement) {
      throw new Error("Bad Request: Expense is not settled");
    }

    const settlement = existing.settlement as { settledAt: string; paidFrom: string; note?: string };
    const seq = existing.settlementSequence;

    // Post settlement reversal strictly
    const postings = expenseSettlementPostings({
      expenseId: existing.id,
      amount: Number(existing.amount),
      sequence: seq,
      paidFrom: settlement.paidFrom,
      paidAt: settlement.settledAt,
      description: existing.description,
      currency: existing.currency,
      isReversal: true,
    });

    await postLedgerEntries(tx, ctx.tenantId, postings, { strict: true });

    const [updated] = await tx
      .update(schema.expenses)
      .set({
        settlement: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.expenses.tenantId, ctx.tenantId),
          eq(schema.expenses.id, expenseId),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error("Failed to unsettle expense");
    }

    // Audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "finance.expense_unsettled",
      targetType: "expense",
      targetId: updated.id,
      diff: {
        reversedSettlement: settlement,
        sequence: seq,
      },
    });

    return {
      id: updated.id,
      templateId: updated.templateId,
      number: `EXP-${updated.id.slice(0, 8).toUpperCase()}`,
      date: updated.date,
      amount: Number(updated.amount),
      currency: updated.currency,
      category: updated.category,
      paidFrom: updated.paidFrom,
      payee: updated.payee,
      note: updated.note,
      receiptMediaId: updated.receiptMediaId,
      settlement: null,
      recurring: updated.recurring as ExpenseItem["recurring"],
      revision: updated.revision,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  });
}

function firstDueFrom(start: string, interval: RecurringInterval, count: number, backfill: boolean, now: Date = new Date()): Date {
  const anchorDay = new Date(`${start.slice(0, 10)}T00:00:00.000Z`).getUTCDate();
  let due = firstRecurringDue(start, interval, count);
  if (backfill) return due;
  while (due.getTime() <= now.getTime()) {
    due = addRecurringInterval(due, interval, count, anchorDay);
  }
  return due;
}

/**
 * Materializes due recurring expense copies for a tenant (docs/FINANCE-PLAN.md §3.7).
 * Capped at <= 12 copies per template per tick. Absorbs races via unique (tenant_id, template_id, date).
 */
export async function runRecurringExpenses(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  tenantId: string,
  now: Date = new Date(),
): Promise<number> {
  const templates = await tx
    .select()
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.tenantId, tenantId),
        sql`${schema.expenses.recurring}->>'enabled' = 'true'`,
        isNull(schema.expenses.templateId),
      ),
    );

  let materializedCount = 0;

  for (const tmpl of templates) {
    const rec = tmpl.recurring as ExpenseItem["recurring"];
    if (!rec || !rec.enabled) continue;

    let nextDue = rec.nextDueAt ? new Date(rec.nextDueAt) : new Date(tmpl.date);
    const endsAt = rec.endsAt ? new Date(rec.endsAt) : null;
    const interval = rec.interval || "monthly";
    const intervalCount = rec.intervalCount || 1;
    const anchorDay = new Date(tmpl.date).getUTCDate();

    let iterations = 0;
    while (nextDue.getTime() <= now.getTime() && iterations < 12) {
      if (endsAt && nextDue.getTime() > endsAt.getTime()) {
        // Disable template as it has reached endsAt
        await tx
          .update(schema.expenses)
          .set({
            recurring: { ...rec, enabled: false },
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.expenses.tenantId, tenantId),
              eq(schema.expenses.id, tmpl.id),
            ),
          );
        break;
      }

      const copyDateStr = nextDue.toISOString().slice(0, 10);
      const copyId = crypto.randomUUID();

      // Insert materialized copy (unique index on tenant, template, date prevents duplicates)
      const inserted = await tx
        .insert(schema.expenses)
        .values({
          id: copyId,
          tenantId,
          templateId: tmpl.id,
          date: copyDateStr,
          category: tmpl.category,
          amount: Number(tmpl.amount),
          currency: tmpl.currency,
          description: tmpl.description,
          payee: tmpl.payee,
          paidFrom: tmpl.paidFrom,
          receiptMediaId: null,
          settlement: null,
          recurring: { enabled: false },
          note: `Recurring copy generated from ${tmpl.id.slice(0, 8)}`,
          revision: 0,
          createdBy: tmpl.createdBy,
        })
        .onConflictDoNothing()
        .returning({ id: schema.expenses.id });

      if (inserted.length > 0) {
        materializedCount++;
        // Post ledger entries for the copy
        const postings = expensePostings({
          expense: {
            id: copyId,
            date: copyDateStr,
            category: tmpl.category,
            amount: Number(tmpl.amount),
            currency: tmpl.currency,
            description: tmpl.description,
            payee: tmpl.payee,
            paidFrom: tmpl.paidFrom,
            revision: 0,
          },
        });
        await postLedgerEntries(tx, tenantId, postings, { strict: false });
      }

      nextDue = addRecurringInterval(nextDue, interval as RecurringInterval, intervalCount, anchorDay);
      iterations++;
    }

    // Advance nextDueAt on template
    await tx
      .update(schema.expenses)
      .set({
        recurring: { ...rec, nextDueAt: nextDue.toISOString() },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.expenses.tenantId, tenantId),
          eq(schema.expenses.id, tmpl.id),
        ),
      );
  }

  return materializedCount;
}
