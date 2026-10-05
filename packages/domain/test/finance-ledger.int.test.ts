/**
 * Integration Test: Real PostgreSQL 18 Finance Ledger Engine (ADR-022, Phase 0).
 *
 * Verifies against real PostgreSQL:
 * 1. Tenant isolation & Row-Level Security on ledger_entries, expenses, fiscal_periods.
 * 2. Idempotent posting insertion with ON CONFLICT DO NOTHING.
 * 3. Fiscal period close boundary shifting (applyPeriodClose).
 * 4. Database-level check constraints (debit <> credit, amount > 0, note length, etc.).
 * 5. Strict vs non-strict posting modes.
 * 6. Trial balance calculation and balance verification.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, withTenant, type DbHandle } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, type Runtime } from "../src/runtime.ts";
import { provisionTenant } from "../src/saas/provisioning.ts";
import {
  LEDGER_ACCOUNT,
  LEDGER_BOOK,
} from "../src/finance/accounts.ts";
import {
  postLedgerEntries,
  postingKey,
  getTrialBalance,
  invalidateClosedPeriodCache,
  type LedgerPosting,
} from "../src/finance/ledger.ts";

let env: TestDb;
let rtPlatform: Runtime;
let dbRw: DbHandle;
let dbPlatform: DbHandle;
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({
    service: "platform",
    databaseUrl: env.as("app_platform"),
    poolMax: 10,
  });
  dbRw = createDb(env.as("app_rw"), { applicationName: "bsec-test-rw" });
  dbPlatform = createDb(env.as("app_platform"), { applicationName: "bsec-test-platform" });

  const randA = Math.random().toString(36).slice(2, 7);
  const randB = Math.random().toString(36).slice(2, 7);

  const tA = await provisionTenant(rtPlatform, {
    storeName: "Finance Store A",
    slug: `finance-a-${randA}`,
    owner: { email: `owner-a-${randA}@finance.test`, name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantA = tA.tenantId;

  const tB = await provisionTenant(rtPlatform, {
    storeName: "Finance Store B",
    slug: `finance-b-${randB}`,
    owner: { email: `owner-b-${randB}@finance.test`, name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantB = tB.tenantId;
}, 180_000);

afterAll(async () => {
  await dbRw?.close();
  await dbPlatform?.close();
});

describe("Finance Tenant Isolation & PostgreSQL RLS", () => {
  it("proves direct query under tenant A cannot read finance rows belonging to tenant B", async () => {
    // 1. Insert rows under Tenant B
    await withTenant(dbRw.db, tenantB, async (tx) => {
      await tx.insert(schema.ledgerEntries).values({
        tenantId: tenantB,
        date: new Date(),
        book: "own",
        debit: LEDGER_ACCOUNT.CASH_BANK,
        credit: LEDGER_ACCOUNT.PRODUCT_REVENUE,
        amount: 50000,
        currency: "INR",
        sourceKind: "order",
        key: "order:b1:revenue",
      });

      await tx.insert(schema.expenses).values({
        tenantId: tenantB,
        date: "2026-10-01",
        category: "software",
        amount: 20000,
        description: "B Software",
        paidFrom: "bank",
        createdBy: "0199a000-0000-7000-8000-000000000001",
      });

      await tx.insert(schema.fiscalPeriods).values({
        tenantId: tenantB,
        periodFrom: "2026-08-01",
        periodTo: "2026-08-31",
        label: "2026-08",
        closedBy: "0199a000-0000-7000-8000-000000000001",
        snapshot: { net: 100000 },
      });
    });

    // 2. Query under Tenant A: must see 0 rows
    await withTenant(dbRw.db, tenantA, async (tx) => {
      const bEntries = await tx
        .select()
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.tenantId, tenantB));
      expect(bEntries).toEqual([]);

      const bExpenses = await tx
        .select()
        .from(schema.expenses)
        .where(eq(schema.expenses.tenantId, tenantB));
      expect(bExpenses).toEqual([]);

      const bPeriods = await tx
        .select()
        .from(schema.fiscalPeriods)
        .where(eq(schema.fiscalPeriods.tenantId, tenantB));
      expect(bPeriods).toEqual([]);
    });

    // 3. Raw pooled app_rw without tenant context sees 0 rows
    const unisolatedEntries = await dbRw.db.select().from(schema.ledgerEntries);
    expect(unisolatedEntries).toEqual([]);
    const unisolatedExpenses = await dbRw.db.select().from(schema.expenses);
    expect(unisolatedExpenses).toEqual([]);
    const unisolatedPeriods = await dbRw.db.select().from(schema.fiscalPeriods);
    expect(unisolatedPeriods).toEqual([]);
  });

  it("proves direct insert under tenant A with tenant B ID is rejected by Postgres RLS WITH CHECK", async () => {
    // Attempt cross-tenant insert on ledger_entries
    let threwEntries = false;
    try {
      await withTenant(dbRw.db, tenantA, async (tx) => {
        await tx.insert(schema.ledgerEntries).values({
          tenantId: tenantB, // Poisoned tenant ID
          date: new Date(),
          debit: LEDGER_ACCOUNT.CASH_BANK,
          credit: LEDGER_ACCOUNT.PRODUCT_REVENUE,
          amount: 10000,
          sourceKind: "order",
          key: "order:cross:revenue",
        });
      });
    } catch (err: unknown) {
      threwEntries = true;
      const msg = String(err) + " " + String((err as { cause?: { message?: string } })?.cause?.message ?? "");
      expect(msg).toMatch(/violates row-level security policy/i);
    }
    expect(threwEntries).toBe(true);

    // Attempt cross-tenant insert on expenses
    let threwExpenses = false;
    try {
      await withTenant(dbRw.db, tenantA, async (tx) => {
        await tx.insert(schema.expenses).values({
          tenantId: tenantB, // Poisoned tenant ID
          date: "2026-10-01",
          category: "other",
          amount: 5000,
          description: "Poisoned Expense",
          createdBy: "0199a000-0000-7000-8000-000000000001",
        });
      });
    } catch (err: unknown) {
      threwExpenses = true;
      const msg = String(err) + " " + String((err as { cause?: { message?: string } })?.cause?.message ?? "");
      expect(msg).toMatch(/violates row-level security policy/i);
    }
    expect(threwExpenses).toBe(true);

    // Attempt cross-tenant insert on fiscal_periods
    let threwPeriods = false;
    try {
      await withTenant(dbRw.db, tenantA, async (tx) => {
        await tx.insert(schema.fiscalPeriods).values({
          tenantId: tenantB, // Poisoned tenant ID
          periodFrom: "2026-07-01",
          periodTo: "2026-07-31",
          label: "2026-07",
          closedBy: "0199a000-0000-7000-8000-000000000001",
          snapshot: {},
        });
      });
    } catch (err: unknown) {
      threwPeriods = true;
      const msg = String(err) + " " + String((err as { cause?: { message?: string } })?.cause?.message ?? "");
      expect(msg).toMatch(/violates row-level security policy/i);
    }
    expect(threwPeriods).toBe(true);
  });

  it("proves app_platform (BYPASSRLS) can inspect all tenant entries", async () => {
    const all = await dbPlatform.db.select().from(schema.ledgerEntries);
    expect(all.length).toBeGreaterThanOrEqual(1);
    const tenantIds = all.map((r) => r.tenantId);
    expect(tenantIds).toContain(tenantB);
  });
});

describe("Idempotent Batch Insertion", () => {
  it("inserts new entries and ignores existing keys on replay", async () => {
    const orderId10 = "0199a000-0000-7000-8000-000000000010";
    const postings: LedgerPosting[] = [
      {
        date: new Date("2026-10-02T10:00:00Z"),
        book: LEDGER_BOOK.OWN,
        debit: LEDGER_ACCOUNT.CASH_BANK,
        credit: LEDGER_ACCOUNT.PRODUCT_REVENUE,
        amount: 10000,
        currency: "INR",
        source: { kind: "order", id: orderId10 },
        key: postingKey("order", orderId10, "revenue"),
      },
      {
        date: new Date("2026-10-02T10:00:00Z"),
        book: LEDGER_BOOK.OWN,
        debit: LEDGER_ACCOUNT.CASH_BANK,
        credit: LEDGER_ACCOUNT.TAX_PAYABLE,
        amount: 1800,
        currency: "INR",
        source: { kind: "order", id: orderId10 },
        key: postingKey("order", orderId10, "tax"),
      },
    ];

    // First write: inserts 2 rows
    const firstCount = await withTenant(dbRw.db, tenantA, async (tx) => {
      return await postLedgerEntries(tx, tenantA, postings);
    });
    expect(firstCount).toBe(2);

    // Immediate replay: inserts 0 rows (ON CONFLICT DO NOTHING)
    const replayCount = await withTenant(dbRw.db, tenantA, async (tx) => {
      return await postLedgerEntries(tx, tenantA, postings);
    });
    expect(replayCount).toBe(0);

    // Partial replay (2 existing + 1 new): inserts only the 1 new row
    const mixedPostings: LedgerPosting[] = [
      ...postings,
      {
        date: new Date("2026-10-02T10:00:00Z"),
        book: LEDGER_BOOK.OWN,
        debit: LEDGER_ACCOUNT.CASH_BANK,
        credit: LEDGER_ACCOUNT.SHIPPING_INCOME,
        amount: 500,
        currency: "INR",
        source: { kind: "order", id: orderId10 },
        key: postingKey("order", orderId10, "shipping"),
      },
    ];

    const mixedCount = await withTenant(dbRw.db, tenantA, async (tx) => {
      return await postLedgerEntries(tx, tenantA, mixedPostings);
    });
    expect(mixedCount).toBe(1);
  });
});

describe("Period Close Shifting", () => {
  it("shifts postings dated within closed periods to closedThrough + 1s with explanatory note", async () => {
    // 1. Close period up to 2026-09-30 for Tenant A
    await withTenant(dbRw.db, tenantA, async (tx) => {
      await tx.insert(schema.fiscalPeriods).values({
        tenantId: tenantA,
        periodFrom: "2026-09-01",
        periodTo: "2026-09-30",
        label: "2026-09",
        closedBy: "0199a000-0000-7000-8000-000000000001",
        snapshot: { net: 50000 },
      });
    });
    invalidateClosedPeriodCache(tenantA);

    // 2. Post entry dated 2026-09-15 (inside closed period)
    const orderIdLate = "0199a000-0000-7000-8000-000000000011";
    const latePosting: LedgerPosting = {
      date: new Date("2026-09-15T14:30:00.000Z"),
      book: LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.CASH_BANK,
      credit: LEDGER_ACCOUNT.PRODUCT_REVENUE,
      amount: 75000,
      currency: "INR",
      source: { kind: "order", id: orderIdLate },
      key: postingKey("order", orderIdLate, "revenue"),
      note: "September backfilled order",
    };

    const inserted = await withTenant(dbRw.db, tenantA, async (tx) => {
      return await postLedgerEntries(tx, tenantA, [latePosting]);
    });
    expect(inserted).toBe(1);

    // 3. Inspect saved row
    const [row] = await withTenant(dbRw.db, tenantA, async (tx) => {
      return await tx
        .select()
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.key, postingKey("order", orderIdLate, "revenue")));
    });

    expect(row).toBeDefined();
    if (!row) throw new Error("Expected row to be defined");
    // Shifted past 2026-09-30T23:59:59.999Z by 1 second -> 2026-10-01T00:00:00.999Z
    expect(row.date.toISOString()).toBe("2026-10-01T00:00:00.999Z");
    expect(row.note).toContain("Dated 2026-09-15, posted after the period close");
    expect(row.note).toContain("September backfilled order");
  });

  it("does not shift postings dated after the closed period", async () => {
    const orderIdOct5 = "0199a000-0000-7000-8000-000000000012";
    const currentPosting: LedgerPosting = {
      date: new Date("2026-10-05T12:00:00.000Z"),
      book: LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.CASH_BANK,
      credit: LEDGER_ACCOUNT.PRODUCT_REVENUE,
      amount: 30000,
      currency: "INR",
      source: { kind: "order", id: orderIdOct5 },
      key: postingKey("order", orderIdOct5, "revenue"),
      note: "October normal order",
    };

    await withTenant(dbRw.db, tenantA, async (tx) => {
      await postLedgerEntries(tx, tenantA, [currentPosting]);
    });

    const [row] = await withTenant(dbRw.db, tenantA, async (tx) => {
      return await tx
        .select()
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.key, postingKey("order", orderIdOct5, "revenue")));
    });

    expect(row).toBeDefined();
    if (!row) throw new Error("Expected row to be defined");
    expect(row.date.toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(row.note).toBe("October normal order");
  });
});

describe("PostgreSQL Check Constraints", () => {
  it("rejects debit === credit at the database level", async () => {
    let threw = false;
    try {
      await withTenant(dbRw.db, tenantA, async (tx) => {
        await tx.insert(schema.ledgerEntries).values({
          tenantId: tenantA,
          date: new Date(),
          debit: LEDGER_ACCOUNT.CASH_BANK,
          credit: LEDGER_ACCOUNT.CASH_BANK, // Forbidden self-cancelling pair
          amount: 5000,
          sourceKind: "adjustment",
          key: "adj:forbidden:debit-eq-credit",
        });
      });
    } catch (err: unknown) {
      threw = true;
      const msg = String(err) + " " + String((err as { cause?: { message?: string } })?.cause?.message ?? "");
      expect(msg).toMatch(/ledger_entries_debit_ne_credit/i);
    }
    expect(threw).toBe(true);
  });

  it("rejects amount <= 0 at the database level", async () => {
    let threw = false;
    try {
      await withTenant(dbRw.db, tenantA, async (tx) => {
        await tx.insert(schema.ledgerEntries).values({
          tenantId: tenantA,
          date: new Date(),
          debit: LEDGER_ACCOUNT.CASH_BANK,
          credit: LEDGER_ACCOUNT.PRODUCT_REVENUE,
          amount: 0, // Forbidden non-positive amount
          sourceKind: "adjustment",
          key: "adj:forbidden:zero-amount",
        });
      });
    } catch (err: unknown) {
      threw = true;
      const msg = String(err) + " " + String((err as { cause?: { message?: string } })?.cause?.message ?? "");
      expect(msg).toMatch(/ledger_entries_amount_positive/i);
    }
    expect(threw).toBe(true);
  });

  it("rejects notes longer than 500 characters", async () => {
    let threw = false;
    try {
      await withTenant(dbRw.db, tenantA, async (tx) => {
        await tx.insert(schema.ledgerEntries).values({
          tenantId: tenantA,
          date: new Date(),
          debit: LEDGER_ACCOUNT.CASH_BANK,
          credit: LEDGER_ACCOUNT.PRODUCT_REVENUE,
          amount: 1000,
          sourceKind: "adjustment",
          key: "adj:forbidden:long-note",
          note: "A".repeat(501),
        });
      });
    } catch (err: unknown) {
      threw = true;
      const msg = String(err) + " " + String((err as { cause?: { message?: string } })?.cause?.message ?? "");
      expect(msg).toMatch(/ledger_entries_note_length/i);
    }
    expect(threw).toBe(true);
  });
});

describe("Strict Mode vs Fire-and-Forget", () => {
  it("fire-and-forget swallows unexpected errors and returns 0", async () => {
    // Note of 501 chars passes isPostingUsable but violates DB check constraint
    const brokenPosting: LedgerPosting = {
      date: new Date(),
      book: LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.CASH_BANK,
      credit: LEDGER_ACCOUNT.PRODUCT_REVENUE,
      amount: 1000,
      currency: "INR",
      source: { kind: "order" },
      key: "order:broken:1",
      note: "X".repeat(501),
    };

    const count = await withTenant(dbRw.db, tenantA, async (tx) => {
      return await postLedgerEntries(tx, tenantA, [brokenPosting], {
        strict: false,
      });
    });
    // In fire-and-forget mode, returns 0 and does not crash
    expect(count).toBe(0);
  });

  it("strict mode rethrows errors", async () => {
    const brokenPosting: LedgerPosting = {
      date: new Date(),
      book: LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.CASH_BANK,
      credit: LEDGER_ACCOUNT.PRODUCT_REVENUE,
      amount: 1000,
      currency: "INR",
      source: { kind: "order" },
      key: "order:broken:2",
      note: "X".repeat(501),
    };

    await expect(
      withTenant(dbRw.db, tenantA, async (tx) => {
        return await postLedgerEntries(tx, tenantA, [brokenPosting], {
          strict: true,
        });
      }),
    ).rejects.toThrow();
  });
});

describe("Trial Balance Calculation", () => {
  it("calculates trial balance matching debits and credits", async () => {
    const tbOrderId = "0199a000-0000-7000-8000-000000000013";
    const tbExpId = "0199a000-0000-7000-8000-000000000014";

    // Post balanced scenario in Tenant B:
    // Sale: Cash Bank +11800, Revenue -10000, Tax -1800
    // Expense: Operating Expense +5000, Cash Bank -5000
    const scenarioPostings: LedgerPosting[] = [
      {
        date: new Date("2026-10-04T10:00:00Z"),
        book: LEDGER_BOOK.OWN,
        debit: LEDGER_ACCOUNT.CASH_BANK,
        credit: LEDGER_ACCOUNT.PRODUCT_REVENUE,
        amount: 10000,
        currency: "INR",
        source: { kind: "order", id: tbOrderId },
        key: `order:${tbOrderId}:revenue`,
      },
      {
        date: new Date("2026-10-04T10:00:00Z"),
        book: LEDGER_BOOK.OWN,
        debit: LEDGER_ACCOUNT.CASH_BANK,
        credit: LEDGER_ACCOUNT.TAX_PAYABLE,
        amount: 1800,
        currency: "INR",
        source: { kind: "order", id: tbOrderId },
        key: `order:${tbOrderId}:tax`,
      },
      {
        date: new Date("2026-10-04T11:00:00Z"),
        book: LEDGER_BOOK.OWN,
        debit: LEDGER_ACCOUNT.OPERATING_EXPENSE,
        credit: LEDGER_ACCOUNT.CASH_BANK,
        amount: 5000,
        currency: "INR",
        source: { kind: "expense", id: tbExpId },
        key: `expense:${tbExpId}:v:0`,
      },
    ];

    await withTenant(dbRw.db, tenantB, async (tx) => {
      await postLedgerEntries(tx, tenantB, scenarioPostings);
    });

    const tb = await withTenant(dbRw.db, tenantB, async (tx) => {
      return await getTrialBalance(tx, tenantB, {
        from: new Date("2026-10-04T00:00:00Z"),
        to: new Date("2026-10-04T23:59:59Z"),
      });
    });

    expect(tb.balanced).toBe(true);
    expect(tb.total).toBe(0);

    // Verify individual account balances:
    // Cash bank: debited 11800, credited 5000 -> net debit balance +6800
    const cashBank = tb.accounts.find((a) => a.account === LEDGER_ACCOUNT.CASH_BANK);
    expect(cashBank?.balance).toBe(6800);

    // Product revenue: credited 10000 -> net credit balance +10000 (signed +10000 for income)
    const rev = tb.accounts.find((a) => a.account === LEDGER_ACCOUNT.PRODUCT_REVENUE);
    expect(rev?.balance).toBe(10000);

    // Tax payable: credited 1800 -> net credit balance +1800 (signed +1800 for liability)
    const tax = tb.accounts.find((a) => a.account === LEDGER_ACCOUNT.TAX_PAYABLE);
    expect(tax?.balance).toBe(1800);

    // Operating expense: debited 5000 -> net debit balance +5000 (signed +5000 for expense)
    const exp = tb.accounts.find((a) => a.account === LEDGER_ACCOUNT.OPERATING_EXPENSE);
    expect(exp?.balance).toBe(5000);
  });
});
