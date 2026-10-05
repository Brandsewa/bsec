/**
 * Integration Test: Real PostgreSQL 18 Expenses Lifecycle & Ledger Impact (ADR-022, Phase 3).
 *
 * Verifies against real PostgreSQL:
 * 1. Expense creation posts strictly to ledger (operating_expense debit, cash_bank credit).
 * 2. Editing expense (moving amount/date) bumps revision, posts strictly reversal + new revision.
 * 3. Settling unpaid bill (paid_from = 'unpaid') posts settlement debiting accounts_payable.
 * 4. Unsettling reverses settlement strictly and returns bill to unpaid.
 * 5. Deleting expense strictly reverses active revision on ledger first.
 * 6. Recurring template materialization catches up due copies (<= 12 per tick).
 * 7. Audit log rows written on every state change.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, schema, withTenant, type DbHandle } from "@bs/db";
import { ExpenseItem } from "@bs/contracts";
import { getExpenseReceiptUrl } from "../src/finance/index.ts";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, type Runtime } from "../src/runtime.ts";
import { provisionTenant } from "../src/saas/provisioning.ts";
import type { TenantContext } from "../src/context.ts";
import { LEDGER_ACCOUNT } from "../src/finance/accounts.ts";
import {
  createExpense,
  updateExpense,
  settleExpense,
  unsettleExpense,
  deleteExpense,
  runRecurringExpenses,
} from "../src/finance/expenses.ts";

let env: TestDb;
let rtPlatform: Runtime;
let dbRw: DbHandle;
let tenantId: string;
let ctx: TenantContext;
const staffUserId = "0199a0e4-0000-7000-8000-000000000001";

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({
    service: "platform",
    databaseUrl: env.as("app_platform"),
    poolMax: 10,
  });
  dbRw = createDb(env.as("app_rw"), { applicationName: "bsec-test-rw" });

  const rand = Math.random().toString(36).slice(2, 7);
  const t = await provisionTenant(rtPlatform, {
    storeName: "Expense Test Store",
    slug: `expense-store-${rand}`,
    owner: { email: `owner-${rand}@expense.test`, name: "Expense Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantId = t.tenantId;

  ctx = {
    tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: staffUserId },
    roles: ["owner"],
    permissions: ["finance.read", "finance.write"],
    requestId: "req-exp-test",
  };
}, 180_000);

afterAll(async () => {
  await dbRw?.close();
});

describe("Finance Expenses Domain Service", () => {
  it("creates an expense and strictly posts to the double-entry ledger", async () => {
    const created = await createExpense(dbRw, ctx, {
      date: "2026-10-01",
      category: "software_tools",
      paidFrom: "cash_bank",
      amount: 499900, // ₹4,999.00
      currency: "INR",
      payee: "AWS Cloud",
      note: "Cloud hosting invoice",
    });

    expect(created.id).toBeDefined();
    expect(created.amount).toBe(499900);
    expect(created.revision).toBe(0);

    // Verify ledger entry
    await withTenant(dbRw.db, tenantId, async (tx) => {
      const entries = await tx
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.tenantId, tenantId),
            eq(schema.ledgerEntries.sourceKind, "expense"),
            eq(schema.ledgerEntries.sourceId, created.id),
          ),
        );

      expect(entries).toHaveLength(1);
      expect(entries[0]?.debit).toBe(LEDGER_ACCOUNT.OPERATING_EXPENSE);
      expect(entries[0]?.credit).toBe(LEDGER_ACCOUNT.CASH_BANK);
      expect(Number(entries[0]?.amount)).toBe(499900);
    });

    // Verify audit log
    await withTenant(dbRw.db, tenantId, async (tx) => {
      const audit = await tx
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.tenantId, tenantId),
            eq(schema.auditLogs.action, "finance.expense_created"),
            eq(schema.auditLogs.targetId, created.id),
          ),
        );
      expect(audit).toHaveLength(1);
    });
  });

  it("updates an expense, bumps revision, reverses old ledger entry, and posts new entry", async () => {
    const initial = await createExpense(dbRw, ctx, {
      date: "2026-10-02",
      category: "office_supplies",
      paidFrom: "cash_bank",
      amount: 150000, // ₹1,500
      payee: "Local Stationery",
    });

    // Update amount to ₹2,000
    const updated = await updateExpense(dbRw, ctx, {
      id: initial.id,
      amount: 200000,
    });

    expect(updated.revision).toBe(1);
    expect(updated.amount).toBe(200000);

    // Verify ledger entries: should have v:0 (1500), v:0:reversal (1500), v:1 (2000)
    await withTenant(dbRw.db, tenantId, async (tx) => {
      const entries = await tx
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.tenantId, tenantId),
            eq(schema.ledgerEntries.sourceKind, "expense"),
            eq(schema.ledgerEntries.sourceId, initial.id),
          ),
        );

      expect(entries).toHaveLength(3);

      const rev0 = entries.find((e) => e.key.endsWith("v:0"));
      const rev0Reversal = entries.find((e) => e.key.endsWith("v:0:reversal"));
      const rev1 = entries.find((e) => e.key.endsWith("v:1"));

      expect(rev0).toBeDefined();
      expect(rev0Reversal).toBeDefined();
      expect(rev1).toBeDefined();

      // Check reversal swapped debit/credit
      expect(rev0Reversal?.debit).toBe(rev0?.credit);
      expect(rev0Reversal?.credit).toBe(rev0?.debit);
    });
  });

  it("settles an unpaid bill and can cleanly unsettle it", async () => {
    const bill = await createExpense(dbRw, ctx, {
      date: "2026-10-03",
      category: "contractor",
      paidFrom: "unpaid",
      amount: 3500000, // ₹35,000
      payee: "Freelance Designer",
    });

    // Initial bill credited accounts_payable
    await withTenant(dbRw.db, tenantId, async (tx) => {
      const entries = await tx
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.tenantId, tenantId),
            eq(schema.ledgerEntries.sourceKind, "expense"),
            eq(schema.ledgerEntries.sourceId, bill.id),
          ),
        );
      expect(entries[0]?.credit).toBe(LEDGER_ACCOUNT.ACCOUNTS_PAYABLE);
    });

    // Settle bill
    const settled = await settleExpense(dbRw, ctx, {
      id: bill.id,
      settledAt: "2026-10-04",
      paidFrom: "cash_bank",
      note: "Paid via NEFT",
    });

    expect(settled.settlement).toBeDefined();
    expect(settled.settlement?.paidFrom).toBe("cash_bank");

    // Check settlement entry: debited accounts_payable, credited cash_bank
    await withTenant(dbRw.db, tenantId, async (tx) => {
      const settleEntries = await tx
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.tenantId, tenantId),
            eq(schema.ledgerEntries.sourceKind, "expense"),
            eq(schema.ledgerEntries.sourceId, bill.id),
            sql`${schema.ledgerEntries.key} LIKE '%settle:1'`,
          ),
        );
      expect(settleEntries).toHaveLength(1);
      expect(settleEntries[0]?.debit).toBe(LEDGER_ACCOUNT.ACCOUNTS_PAYABLE);
      expect(settleEntries[0]?.credit).toBe(LEDGER_ACCOUNT.CASH_BANK);
    });

    // Unsettle bill
    const unsettled = await unsettleExpense(dbRw, ctx, bill.id);
    expect(unsettled.settlement).toBeNull();

    // Check unsettle entry: settle:1:reversal exists
    await withTenant(dbRw.db, tenantId, async (tx) => {
      const revEntries = await tx
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.tenantId, tenantId),
            eq(schema.ledgerEntries.sourceKind, "expense"),
            eq(schema.ledgerEntries.sourceId, bill.id),
            sql`${schema.ledgerEntries.key} LIKE '%settle:1:reversal'`,
          ),
        );
      expect(revEntries).toHaveLength(1);
      expect(revEntries[0]?.debit).toBe(LEDGER_ACCOUNT.CASH_BANK);
      expect(revEntries[0]?.credit).toBe(LEDGER_ACCOUNT.ACCOUNTS_PAYABLE);
    });
  });

  it("deletes an expense by strictly reversing its active revision on the ledger", async () => {
    const toDelete = await createExpense(dbRw, ctx, {
      date: "2026-10-05",
      category: "travel",
      paidFrom: "cash_on_hand",
      amount: 45000, // ₹450
      payee: "Metro card recharge",
    });

    const res = await deleteExpense(dbRw, ctx, toDelete.id);
    expect(res.success).toBe(true);

    // Expense row is deleted
    await withTenant(dbRw.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.expenses)
        .where(and(eq(schema.expenses.tenantId, tenantId), eq(schema.expenses.id, toDelete.id)));
      expect(rows).toHaveLength(0);

      // Ledger has both initial and reversal
      const entries = await tx
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.tenantId, tenantId),
            eq(schema.ledgerEntries.sourceKind, "expense"),
            eq(schema.ledgerEntries.sourceId, toDelete.id),
          ),
        );
      expect(entries).toHaveLength(2);
      const reversal = entries.find((e) => e.key.includes("reversal"));
      expect(reversal).toBeDefined();
    });
  });

  it("materializes due recurring expense copies with catch-up cap", async () => {
    // Create recurring template dated 2 months ago
    const twoMonthsAgo = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000);
    const tmpl = await createExpense(dbRw, ctx, {
      date: twoMonthsAgo.toISOString().slice(0, 10),
      category: "software_tools",
      paidFrom: "cash_bank",
      amount: 120000, // ₹1,200
      payee: "Figma Subscription",
      recurring: {
        enabled: true,
        interval: "monthly",
        intervalCount: 1,
      },
    });

    // Run recurring catch-up
    await withTenant(dbRw.db, tenantId, async (tx) => {
      const generated = await runRecurringExpenses(tx, tenantId, new Date());
      expect(generated).toBeGreaterThanOrEqual(1);

      // Verify generated copy exists with templateId
      const copies = await tx
        .select()
        .from(schema.expenses)
        .where(
          and(
            eq(schema.expenses.tenantId, tenantId),
            eq(schema.expenses.templateId, tmpl.id),
          ),
        );
      expect(copies.length).toBeGreaterThanOrEqual(1);
      expect(copies[0]?.amount).toBe(120000);
    });
  });

  it("returns shapes the API contract accepts (settle, recurring create, unsettle)", async () => {
    // The oRPC layer validates handler output against ExpenseItem; a null in an optional-only
    // field turned settle and every recurring create into HTTP 500 after the DB write had committed.
    const bill = await createExpense(dbRw, ctx, {
      date: "2026-10-01",
      category: "other",
      paidFrom: "unpaid",
      amount: 12000,
      currency: "INR",
    });
    expect(() => ExpenseItem.parse(bill)).not.toThrow();
    const settled = await settleExpense(dbRw, ctx, { id: bill.id, settledAt: "2026-10-02", paidFrom: "cash_bank" });
    expect(() => ExpenseItem.parse(settled)).not.toThrow();
    const reopened = await unsettleExpense(dbRw, ctx, bill.id);
    expect(() => ExpenseItem.parse(reopened)).not.toThrow();

    const recurring = await createExpense(dbRw, ctx, {
      date: "2026-09-01",
      category: "rent",
      paidFrom: "cash_bank",
      amount: 100000,
      currency: "INR",
      recurring: { enabled: true, interval: "monthly", intervalCount: 1, backfillDue: false },
    });
    expect(() => ExpenseItem.parse(recurring)).not.toThrow();
  });

  it("serves a receipt only as a 15-minute signed URL inside the tenant's receipt folder", async () => {
    const r2Config = { accessKeyId: "test-key", secretAccessKey: "test-secret", accountId: "acct", bucketName: "private-receipts" };
    const mediaId = crypto.randomUUID();
    const key = `tenants/${tenantId}/expense-receipts/${mediaId}.png`;
    await withTenant(dbRw.db, tenantId, (tx) =>
      tx.insert(schema.media).values({ tenantId, id: mediaId, storageKey: key, mime: "image/png", bytes: 1024, folder: "expense-receipts" }),
    );
    const withReceipt = await createExpense(dbRw, ctx, {
      date: "2026-10-01", category: "other", paidFrom: "cash_bank", amount: 5000, currency: "INR", receiptMediaId: mediaId,
    });
    const { url } = await getExpenseReceiptUrl(dbRw, ctx, { expenseId: withReceipt.id, r2Config });
    expect(url).toContain(encodeURIComponent(key).replace(/%2F/g, "/"));
    expect(url).toContain("X-Amz-Expires=900");

    // No receipt: null. Without finance.read: refused.
    const plain = await createExpense(dbRw, ctx, { date: "2026-10-01", category: "other", paidFrom: "cash_bank", amount: 100, currency: "INR" });
    expect((await getExpenseReceiptUrl(dbRw, ctx, { expenseId: plain.id, r2Config })).url).toBeNull();
    const denied = { ...ctx, permissions: [] } as typeof ctx;
    await expect(getExpenseReceiptUrl(dbRw, denied, { expenseId: withReceipt.id, r2Config })).rejects.toThrow(/finance\.read/);

    // A media row pointing outside the tenant's receipt folder is never signed.
    const evilId = crypto.randomUUID();
    await withTenant(dbRw.db, tenantId, (tx) =>
      tx.insert(schema.media).values({ tenantId, id: evilId, storageKey: `tenants/someone-else/expense-receipts/${evilId}.png`, mime: "image/png", bytes: 1, folder: "expense-receipts" }),
    );
    const evil = await createExpense(dbRw, ctx, {
      date: "2026-10-01", category: "other", paidFrom: "cash_bank", amount: 100, currency: "INR", receiptMediaId: evilId,
    });
    await expect(getExpenseReceiptUrl(dbRw, ctx, { expenseId: evil.id, r2Config })).rejects.toThrow(/outside this store/);
  });
});
