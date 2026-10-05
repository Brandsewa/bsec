/**
 * Double-entry ledger engine (ADR-022, docs/FINANCE-PLAN.md §3.3).
 *
 * Implements:
 * 1. Deterministic posting keys: postingKey(kind, id, ...parts)
 * 2. Period close date shifting: applyPeriodClose()
 * 3. Batch idempotent insertion: postLedgerEntries() with ON CONFLICT DO NOTHING
 * 4. In-process 60-second closedThrough caching and invalidation hook
 * 5. Trial balance verification: getTrialBalance()
 */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import {
  debitSign,
  type LedgerAccount,
  type LedgerBook,
} from "./accounts.ts";

export type LedgerSourceKind =
  | "order"
  | "refund"
  | "expense"
  | "adjustment"
  | "shipment";

export interface LedgerPosting {
  date: Date;
  book: LedgerBook;
  debit: LedgerAccount;
  credit: LedgerAccount;
  amount: number;
  currency: string;
  source: {
    kind: LedgerSourceKind;
    id?: string | null;
    ref?: string | null;
  };
  key: string;
  note?: string | null;
}

/**
 * Builds a deterministic, lowercased idempotency key:
 * format: "kind:id:part1:part2"
 */
export function postingKey(
  kind: LedgerSourceKind,
  id: unknown,
  ...parts: Array<string | number | undefined | null>
): string {
  const safeId = id !== undefined && id !== null && String(id).trim().length > 0
    ? String(id).trim()
    : "none";
  const validParts = parts
    .filter((p) => p !== undefined && p !== null)
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0);

  return [kind, safeId, ...validParts].join(":").toLowerCase();
}

/** Determines if a posting is structurally usable for writing to the ledger. */
export function isPostingUsable(posting: LedgerPosting): boolean {
  if (!posting.key || posting.key.trim().length === 0) return false;
  if (!Number.isFinite(posting.amount) || posting.amount <= 0) return false;
  if (!posting.currency || posting.currency.trim().length === 0) return false;
  if (posting.debit === posting.credit) return false;
  return true;
}

const NOTE_MAX_LENGTH = 500;

/**
 * Checks if a posting is dated within or before a closed fiscal period.
 * If so, shifts the posting date to closedThrough + 1s and appends an audit note.
 */
export function applyPeriodClose(
  posting: LedgerPosting,
  closedThrough: Date | null,
): LedgerPosting {
  if (!closedThrough || posting.date.getTime() > closedThrough.getTime()) {
    return posting;
  }

  const shiftedDate = new Date(closedThrough.getTime() + 1000);
  const originalDateStr = posting.date.toISOString().slice(0, 10);
  const suffix = `Dated ${originalDateStr}, posted after the period close`;

  const room = NOTE_MAX_LENGTH - suffix.length - 3;
  const kept = posting.note
    ? posting.note.length > room
      ? `${posting.note.slice(0, Math.max(0, room - 1)).trimEnd()}…`
      : posting.note
    : null;

  return {
    ...posting,
    date: shiftedDate,
    note: kept ? `${kept} · ${suffix}` : suffix,
  };
}

/**
 * In-process cache for the latest closed period timestamp per tenant (60 s TTL).
 */
interface ClosedThroughCacheEntry {
  value: Date | null;
  at: number;
}

const closedThroughCache = new Map<string, ClosedThroughCacheEntry>();
const CLOSED_THROUGH_TTL_MS = 60_000;

/**
 * Invalidates the cached closed period boundary for a specific tenant,
 * or across all tenants if no tenantId is supplied.
 */
export function invalidateClosedPeriodCache(tenantId?: string): void {
  if (tenantId) {
    closedThroughCache.delete(tenantId);
  } else {
    closedThroughCache.clear();
  }
}

/**
 * Reads the latest closed period boundary for a tenant, utilizing the 60s in-process cache.
 */
export async function getClosedThrough(
  db: Db,
  tenantId: string,
): Promise<Date | null> {
  const cached = closedThroughCache.get(tenantId);
  if (cached && Date.now() - cached.at < CLOSED_THROUGH_TTL_MS) {
    return cached.value;
  }

  const latest = await db
    .select({
      periodTo: schema.fiscalPeriods.periodTo,
    })
    .from(schema.fiscalPeriods)
    .where(eq(schema.fiscalPeriods.tenantId, tenantId))
    .orderBy(desc(schema.fiscalPeriods.periodTo))
    .limit(1);

  let result: Date | null = null;
  if (latest.length > 0 && latest[0]?.periodTo) {
    // periodTo is a date string YYYY-MM-DD; inclusive last instant is 23:59:59.999Z
    result = new Date(`${latest[0].periodTo}T23:59:59.999Z`);
  }

  closedThroughCache.set(tenantId, { value: result, at: Date.now() });
  return result;
}

export interface PostLedgerOptions {
  /**
   * If true, throws errors if a posting fails database validation or insertion.
   * Used for user-typed adjustments and expenses.
   * If false, logs and returns 0 on failure (fire-and-forget for order events).
   */
  strict?: boolean;
}

/**
 * Posts entries to the ledger with idempotent ON CONFLICT (tenant_id, key) DO NOTHING.
 * Returns the count of newly inserted rows.
 */
export async function postLedgerEntries(
  db: Db,
  tenantId: string,
  postings: LedgerPosting[],
  options: PostLedgerOptions = {},
): Promise<number> {
  const { strict = false } = options;

  const validPostings = postings.filter(isPostingUsable);
  if (validPostings.length === 0) return 0;

  try {
    const closedThrough = await getClosedThrough(db, tenantId).catch(() => null);

    const rows = validPostings.map((raw) => {
      const p = applyPeriodClose(raw, closedThrough);
      return {
        tenantId,
        date: p.date,
        book: p.book,
        debit: p.debit,
        credit: p.credit,
        amount: Math.trunc(p.amount),
        currency: p.currency.toUpperCase(),
        sourceKind: p.source.kind,
        sourceId: p.source.id ?? null,
        sourceRef: p.source.ref ?? null,
        key: p.key,
        note: p.note ?? null,
      };
    });

    const inserted = await db
      .insert(schema.ledgerEntries)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: schema.ledgerEntries.id });

    return inserted.length;
  } catch (error) {
    console.error("Failed to post ledger entries:", error);
    if (strict) {
      throw error;
    }
    return 0;
  }
}

export interface ListLedgerEntriesFilter {
  book?: string | undefined;
  account?: string | undefined;
  sourceKind?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Lists ledger entries with pagination and optional filtering by account, source, and date range.
 */
export async function listLedgerEntries(
  db: Db,
  tenantId: string,
  filter: ListLedgerEntriesFilter = {},
) {
  const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);

  const conditions = [eq(schema.ledgerEntries.tenantId, tenantId)];

  if (filter.book) {
    conditions.push(eq(schema.ledgerEntries.book, filter.book));
  }
  if (filter.sourceKind) {
    conditions.push(eq(schema.ledgerEntries.sourceKind, filter.sourceKind));
  }
  if (filter.from) {
    conditions.push(gte(schema.ledgerEntries.date, filter.from));
  }
  if (filter.to) {
    conditions.push(lte(schema.ledgerEntries.date, filter.to));
  }
  if (filter.account) {
    conditions.push(
      sql`(${schema.ledgerEntries.debit} = ${filter.account} OR ${schema.ledgerEntries.credit} = ${filter.account})`,
    );
  }

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.ledgerEntries)
    .where(and(...conditions));

  const rows = await db
    .select()
    .from(schema.ledgerEntries)
    .where(and(...conditions))
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
    reason: r.sourceRef,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));

  return {
    items,
    total: countRow?.count ?? 0,
  };
}

export interface TrialBalanceAccount {
  account: LedgerAccount;
  currency: string;
  balance: number;
  debitSum: number;
  creditSum: number;
}

export interface TrialBalanceResult {
  accounts: TrialBalanceAccount[];
  total: number;
  balanced: boolean;
}

export interface TrialBalanceFilter {
  book?: LedgerBook | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  currency?: string | undefined;
}

/**
 * Computes the trial balance for a tenant's ledger.
 * Returns per-account signed totals and verifies debit-credit equality.
 */
export async function getTrialBalance(
  db: Db,
  tenantId: string,
  filter: TrialBalanceFilter = {},
): Promise<TrialBalanceResult> {
  const conditions = [eq(schema.ledgerEntries.tenantId, tenantId)];

  if (filter.book) {
    conditions.push(eq(schema.ledgerEntries.book, filter.book));
  }
  if (filter.from) {
    conditions.push(gte(schema.ledgerEntries.date, filter.from));
  }
  if (filter.to) {
    conditions.push(lte(schema.ledgerEntries.date, filter.to));
  }
  if (filter.currency) {
    conditions.push(
      eq(schema.ledgerEntries.currency, filter.currency.toUpperCase()),
    );
  }

  const whereClause = and(...conditions);

  // Grouped sum of debits
  const debitRows = await db
    .select({
      account: schema.ledgerEntries.debit,
      currency: schema.ledgerEntries.currency,
      total: sql<string>`coalesce(sum(${schema.ledgerEntries.amount}), 0)`,
    })
    .from(schema.ledgerEntries)
    .where(whereClause)
    .groupBy(schema.ledgerEntries.debit, schema.ledgerEntries.currency);

  // Grouped sum of credits
  const creditRows = await db
    .select({
      account: schema.ledgerEntries.credit,
      currency: schema.ledgerEntries.currency,
      total: sql<string>`coalesce(sum(${schema.ledgerEntries.amount}), 0)`,
    })
    .from(schema.ledgerEntries)
    .where(whereClause)
    .groupBy(schema.ledgerEntries.credit, schema.ledgerEntries.currency);

  // Combine into account maps by "account:currency"
  const accountMap = new Map<
    string,
    { account: LedgerAccount; currency: string; debitSum: number; creditSum: number }
  >();

  for (const row of debitRows) {
    const key = `${row.account}:${row.currency}`;
    const entry = accountMap.get(key) ?? {
      account: row.account as LedgerAccount,
      currency: row.currency,
      debitSum: 0,
      creditSum: 0,
    };
    entry.debitSum += Number(row.total);
    accountMap.set(key, entry);
  }

  for (const row of creditRows) {
    const key = `${row.account}:${row.currency}`;
    const entry = accountMap.get(key) ?? {
      account: row.account as LedgerAccount,
      currency: row.currency,
      debitSum: 0,
      creditSum: 0,
    };
    entry.creditSum += Number(row.total);
    accountMap.set(key, entry);
  }

  let totalDebits = 0;
  let totalCredits = 0;

  const accounts: TrialBalanceAccount[] = [];

  for (const entry of accountMap.values()) {
    const sign = debitSign(entry.account);
    const balance =
      sign === 1
        ? entry.debitSum - entry.creditSum
        : entry.creditSum - entry.debitSum;

    totalDebits += entry.debitSum;
    totalCredits += entry.creditSum;

    accounts.push({
      account: entry.account,
      currency: entry.currency,
      balance,
      debitSum: entry.debitSum,
      creditSum: entry.creditSum,
    });
  }

  // Sort accounts by account name then currency
  accounts.sort((a, b) =>
    a.account.localeCompare(b.account) || a.currency.localeCompare(b.currency),
  );

  const imbalance = totalDebits - totalCredits;
  const balanced = Math.abs(imbalance) < 5; // Balanced within 5 paise per plan 3.3

  return {
    accounts,
    total: imbalance,
    balanced,
  };
}
