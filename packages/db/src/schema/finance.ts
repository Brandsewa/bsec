import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { media } from "./catalog.ts";

/**
 * Double-entry ledger entries (ADR-022, docs/FINANCE-PLAN.md §3.2).
 * Append-only spine of the store's books. Rows are never edited or deleted;
 * corrections are posted as balancing reversal entries.
 */
export const ledgerEntries = tenantTable(
  "ledger_entries",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    book: text("book").notNull().default("own"),
    debit: text("debit").notNull(),
    credit: text("credit").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("INR"),
    sourceKind: text("source_kind").notNull(),
    sourceId: uuid("source_id"),
    sourceRef: text("source_ref"),
    key: text("key").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("ledger_entries_tenant_id_uniq").on(t.tenantId, t.id),
    unique("ledger_entries_tenant_key_uniq").on(t.tenantId, t.key),
    check("ledger_entries_amount_positive", sql`amount > 0`),
    check("ledger_entries_debit_ne_credit", sql`debit <> credit`),
    check("ledger_entries_note_length", sql`note is null or length(note) <= 500`),
    index("ledger_entries_tenant_book_date_idx").on(t.tenantId, t.book, t.date),
    index("ledger_entries_tenant_debit_date_idx").on(t.tenantId, t.debit, t.date),
    index("ledger_entries_tenant_credit_date_idx").on(t.tenantId, t.credit, t.date),
    index("ledger_entries_tenant_source_idx").on(t.tenantId, t.sourceKind, t.sourceId),
  ],
);

/**
 * Store expenses (ADR-022, docs/FINANCE-PLAN.md §3.2).
 * Hand-entered operational, supply, inventory, and marketing costs with receipts,
 * revision tracking, settlements, and recurring schedules.
 */
export const expenses = tenantTable(
  "expenses",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    date: date("date").notNull(),
    category: text("category").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("INR"),
    description: text("description").notNull(),
    payee: text("payee"),
    paidFrom: text("paid_from").notNull().default("bank"),
    receiptMediaId: uuid("receipt_media_id"),
    settlement: jsonb("settlement"),
    settlementSequence: integer("settlement_sequence").notNull().default(0),
    recurring: jsonb("recurring"),
    templateId: uuid("template_id"),
    note: text("note"),
    revision: integer("revision").notNull().default(0),
    debitAccount: text("debit_account"),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("expenses_tenant_id_uniq").on(t.tenantId, t.id),
    check("expenses_amount_non_negative", sql`amount >= 0`),
    check("expenses_description_length", sql`length(description) >= 2 and length(description) <= 300`),
    check("expenses_payee_length", sql`payee is null or length(payee) <= 200`),
    check("expenses_note_length", sql`note is null or length(note) <= 1000`),
    index("expenses_tenant_date_idx").on(t.tenantId, t.date),
    index("expenses_tenant_category_date_idx").on(t.tenantId, t.category, t.date),
    uniqueIndex("expenses_tenant_template_date_uniq")
      .on(t.tenantId, t.templateId, t.date)
      .where(sql`template_id is not null`),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.receiptMediaId,
      target: media,
      name: "expenses_receipt_media_fk",
      onDelete: "set null",
    }),
  ],
);

/**
 * Fiscal periods for month-end close (ADR-022, docs/FINANCE-PLAN.md §3.2).
 * Snapshot records of closed periods. Postings dated within closed periods
 * shift past periodTo instead of altering closed figures.
 */
export const fiscalPeriods = tenantTable(
  "fiscal_periods",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    label: text("label").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().default(sql`now()`),
    closedBy: uuid("closed_by").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("fiscal_periods_tenant_id_uniq").on(t.tenantId, t.id),
    unique("fiscal_periods_tenant_label_uniq").on(t.tenantId, t.label),
    check("fiscal_periods_note_length", sql`note is null or length(note) <= 500`),
    index("fiscal_periods_tenant_period_to_idx").on(t.tenantId, t.periodTo),
  ],
);
