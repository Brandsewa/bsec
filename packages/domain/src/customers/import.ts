import { and, eq, inArray } from "drizzle-orm";
import { type Db, QUEUE_NAMES, schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { setMarketingConsent } from "./consent.ts";

/**
 * CSV customer import (Customers Phase 1, step 1C).
 * Consent is recorded only when the file says so (`marketing_consent` = yes/subscribed/true,
 * source `import`); a blank or any other value never changes consent. Existing customers are
 * updated on name and tags only — consent and phone are never overwritten from a file.
 */

export const IMPORT_MAX_ROWS = 10_000;
/** Up to this many rows are imported inline; bigger files go through the `customers.import` job. */
export const IMPORT_INLINE_MAX_ROWS = 500;

export interface CustomerImportRow {
  name?: string | undefined;
  email: string;
  phone?: string | undefined;
  tags?: string[] | undefined;
  marketingConsent?: string | undefined;
}

export interface ImportRowIssue {
  row: number;
  email: string;
  error: string;
}

export interface ImportPreview {
  total: number;
  created: number;
  updated: number;
  duplicatesInFile: number;
  subscribeCount: number;
  invalid: ImportRowIssue[];
}

export type ImportCommitResult =
  | { queued: true; total: number }
  | { created: number; updated: number; skipped: number; errors: ImportRowIssue[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Consent is only recorded when the file explicitly says so (DPDP: an affirmative act). */
export const importConsentAsked = (raw: string | undefined): boolean =>
  ["yes", "subscribed", "true"].includes((raw ?? "").trim().toLowerCase());

/** Phones are stored as digits only, the same normalisation checkout uses. */
export const normaliseImportPhone = (raw: string | undefined): string | null => {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits ? digits : null;
};

interface NormalisedImportRow {
  name: string;
  email: string;
  phone: string | null;
  tags: string[];
  consent: boolean;
}

function normaliseRows(rows: CustomerImportRow[]): { rows: NormalisedImportRow[]; issues: ImportRowIssue[] } {
  const clean: NormalisedImportRow[] = [];
  const issues: ImportRowIssue[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const rowNo = index + 2; // +2: CSV headers occupy row 1, rows are 1-indexed for humans
    const email = (row.email ?? "").trim().toLowerCase();
    if (!email) {
      issues.push({ row: rowNo, email: "", error: "email is required" });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      issues.push({ row: rowNo, email, error: "not a valid email" });
      return;
    }
    if (seen.has(email)) {
      issues.push({ row: rowNo, email, error: "duplicate email in the file (the first row wins)" });
      return;
    }
    seen.add(email);
    const tags = [...new Set((row.tags ?? []).map((t) => t.trim()).filter(Boolean))];
    clean.push({
      name: (row.name ?? "").trim(),
      email,
      phone: normaliseImportPhone(row.phone),
      tags,
      consent: importConsentAsked(row.marketingConsent),
    });
  });
  return { rows: clean, issues };
}

export async function previewCustomerImport(rt: Runtime, ctx: TenantContext, input: { rows: CustomerImportRow[] }): Promise<ImportPreview> {
  assertPermission(ctx, "customers.write");
  if (input.rows.length > IMPORT_MAX_ROWS) {
    throw new Error(`An import can hold at most ${IMPORT_MAX_ROWS.toLocaleString("en-IN")} rows`);
  }
  const db = rt._db.db;
  const { rows, issues } = normaliseRows(input.rows);

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const emails = rows.map((r) => r.email);
    const existing = emails.length
      ? await tx
          .select({ email: schema.customers.email })
          .from(schema.customers)
          .where(and(eq(schema.customers.tenantId, ctx.tenantId), inArray(schema.customers.email, emails)))
      : [];
    const known = new Set(existing.map((e) => e.email));

    let created = 0;
    let updated = 0;
    let subscribeCount = 0;
    for (const r of rows) {
      if (known.has(r.email)) updated++;
      else created++;
      if (r.consent) subscribeCount++;
    }
    return {
      total: input.rows.length,
      created,
      updated,
      duplicatesInFile: issues.filter((i) => i.error.includes("duplicate")).length,
      subscribeCount,
      invalid: issues,
    };
  });
}

export async function commitCustomerImport(rt: Runtime, ctx: TenantContext, input: { rows: CustomerImportRow[] }): Promise<ImportCommitResult> {
  assertPermission(ctx, "customers.write");
  if (input.rows.length > IMPORT_MAX_ROWS) {
    throw new Error(`An import can hold at most ${IMPORT_MAX_ROWS.toLocaleString("en-IN")} rows`);
  }
  const db = rt._db.db;
  const actorId = ctx.actor.type === "staff" ? ctx.actor.userId : null;

  // Large files run in the worker so the request returns immediately.
  if (input.rows.length > IMPORT_INLINE_MAX_ROWS && rt._jobs) {
    await rt._jobs.send(QUEUE_NAMES.CUSTOMERS_IMPORT, { tenantId: ctx.tenantId, rows: input.rows, actorId });
    return { queued: true, total: input.rows.length };
  }

  const result = await commitImportRows(db, ctx.tenantId, { type: ctx.actor.type, userId: actorId }, input.rows);
  return { created: result.created, updated: result.updated, skipped: result.errors.length, errors: result.errors };
}

export interface ImportActor {
  type: string;
  userId: string | null;
}

/**
 * The row processor shared by the request path and the `customers.import` worker job
 * (which has only a database handle, no Runtime). Runs in one transaction per call.
 */
export async function commitImportRows(
  db: Db,
  tenantId: string,
  actor: ImportActor,
  rawRows: CustomerImportRow[],
  preIssues: ImportRowIssue[] = [],
): Promise<{ created: number; updated: number; errors: ImportRowIssue[] }> {
  const { rows, issues } = normaliseRows(rawRows);
  const errors: ImportRowIssue[] = [...preIssues, ...issues];
  let created = 0;
  let updated = 0;

  await withTenant(db, tenantId, async (tx) => {
    // The consent writer is always called with the caller's transaction, so it never
    // opens its own pool; the Runtime cast is for its signature only.
    const rtShim = { _db: { db } } as unknown as Runtime;
    const consentCtx = { tenantId, actor: { type: actor.type, ...(actor.userId ? { userId: actor.userId } : {}) } };

    for (const [index, r] of rows.entries()) {
      const rowNo = index + 2;
      try {
        const [existing] = await tx
          .select({ id: schema.customers.id, name: schema.customers.name, tags: schema.customers.tags, phone: schema.customers.phone })
          .from(schema.customers)
          .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.email, r.email)))
          .limit(1);

        if (existing) {
          // Existing customers: name and tags only; consent and phone are never touched by a file.
          const mergedTags = [...new Set([...existing.tags, ...r.tags])];
          const name = r.name || existing.name;
          const changedTags = mergedTags.length !== existing.tags.length || [...mergedTags].sort().join("\n") !== [...existing.tags].sort().join("\n");
          if (name !== existing.name || changedTags) {
            await tx
              .update(schema.customers)
              .set({ name, tags: mergedTags, updatedAt: new Date() })
              .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, existing.id)));
            await tx.insert(schema.auditLogs).values({
              tenantId,
              actorType: actor.type,
              actorId: actor.userId,
              action: "customer.updated",
              targetType: "customer",
              targetId: existing.id,
              diff: { source: "import", ...(name !== existing.name ? { name: { from: existing.name, to: name } } : {}), ...(changedTags ? { tags: { to: mergedTags } } : {}) },
            });
          }
          updated++;
          // A file may also subscribe an EXISTING contact: only when the row says so.
          if (r.consent) {
            await setMarketingConsent(rtShim, consentCtx, { customerId: existing.id, state: "subscribed", source: "import", actorType: actor.type === "staff" ? "staff" : "system", actorId: actor.userId }, tx);
          }
        } else {
          if (r.phone) {
            const [phoneTaken] = await tx
              .select({ id: schema.customers.id })
              .from(schema.customers)
              .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.phone, r.phone)))
              .limit(1);
            if (phoneTaken) {
              errors.push({ row: rowNo, email: r.email, error: `phone ${r.phone} already belongs to another customer` });
              continue;
            }
          }
          const [row] = await tx
            .insert(schema.customers)
            .values({ tenantId, email: r.email, name: r.name, phone: r.phone, tags: r.tags, isGuest: false })
            .returning({ id: schema.customers.id });
          if (!row) throw new Error("Failed to create imported customer");
          await tx.insert(schema.auditLogs).values({
            tenantId,
            actorType: actor.type,
            actorId: actor.userId,
            action: "customer.created",
            targetType: "customer",
            targetId: row.id,
            diff: { source: "import", name: r.name, email: r.email },
          });
          if (r.consent) {
            await setMarketingConsent(rtShim, consentCtx, { customerId: row.id, state: "subscribed", source: "import", actorType: actor.type === "staff" ? "staff" : "system", actorId: actor.userId }, tx);
          }
          created++;
        }
      } catch (e) {
        errors.push({ row: rowNo, email: r.email, error: e instanceof Error ? e.message : "import failed" });
      }
    }

    await tx.insert(schema.auditLogs).values({
      tenantId,
      actorType: actor.type,
      actorId: actor.userId,
      action: "customer.import_committed",
      targetType: "store",
      targetId: tenantId,
      diff: { total: rawRows.length, created, updated, failed: errors.length },
    });
  });

  return { created, updated, errors };
}
