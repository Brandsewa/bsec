import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { setMarketingConsent } from "../customers/consent.ts";

/** Audit row for an inbox change (AGENTS.md rule 6). */
async function audit(tx: Parameters<Parameters<typeof withTenant>[2]>[0], ctx: TenantContext, action: string, targetType: string, targetId: string, diff: Record<string, unknown>) {
  await tx.insert(schema.auditLogs).values({
    tenantId: ctx.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
    action,
    targetType,
    targetId,
    diff,
  });
}

// ---- Form submissions ------------------------------------------------------------------------------------------------

export interface ListFormSubmissionsInput {
  status?: "new" | "read" | "archived" | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function listAdminFormSubmissions(rt: Runtime, ctx: TenantContext, input: ListFormSubmissionsInput = {}) {
  assertPermission(ctx, "customers.read");
  const limit = Math.min(100, Math.max(1, input.limit ?? 25));
  const offset = Math.max(0, input.offset ?? 0);
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const where = and(
      eq(schema.formSubmissions.tenantId, ctx.tenantId),
      input.status ? eq(schema.formSubmissions.status, input.status) : sql`${schema.formSubmissions.status} <> 'archived'`,
      input.search?.trim()
        ? sql`(${schema.formSubmissions.name} ILIKE ${`%${input.search.trim()}%`} OR ${schema.formSubmissions.email}::text ILIKE ${`%${input.search.trim()}%`} OR ${schema.formSubmissions.message} ILIKE ${`%${input.search.trim()}%`})`
        : undefined,
    );
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.formSubmissions).where(where);
    const rows = await tx.select().from(schema.formSubmissions).where(where).orderBy(desc(schema.formSubmissions.createdAt)).limit(limit).offset(offset);
    const [unread] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.formSubmissions)
      .where(and(eq(schema.formSubmissions.tenantId, ctx.tenantId), eq(schema.formSubmissions.status, "new")));
    return {
      items: rows.map((r) => ({
        id: r.id,
        formName: r.formName,
        name: r.name,
        email: r.email as string,
        phone: r.phone,
        choice: r.choice,
        message: r.message,
        recipientEmail: r.recipientEmail,
        status: r.status as "new" | "read" | "archived",
        createdAt: r.createdAt.toISOString(),
      })),
      total: count?.n ?? 0,
      unread: unread?.n ?? 0,
    };
  });
}

export async function setAdminFormSubmissionStatus(rt: Runtime, ctx: TenantContext, input: { ids: string[]; status: "new" | "read" | "archived" }) {
  assertPermission(ctx, "customers.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const done = await tx
      .update(schema.formSubmissions)
      .set({ status: input.status })
      .where(and(eq(schema.formSubmissions.tenantId, ctx.tenantId), inArray(schema.formSubmissions.id, input.ids)))
      .returning({ id: schema.formSubmissions.id });
    if (done.length > 0) await audit(tx, ctx, `form_submission.${input.status}`, "form_submission", done[0]?.id ?? "", { count: done.length });
    return { count: done.length };
  });
}

export async function deleteAdminFormSubmissions(rt: Runtime, ctx: TenantContext, input: { ids: string[] }) {
  assertPermission(ctx, "customers.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const done = await tx
      .delete(schema.formSubmissions)
      .where(and(eq(schema.formSubmissions.tenantId, ctx.tenantId), inArray(schema.formSubmissions.id, input.ids)))
      .returning({ id: schema.formSubmissions.id });
    if (done.length > 0) await audit(tx, ctx, "form_submission.deleted", "form_submission", done[0]?.id ?? "", { count: done.length });
    return { count: done.length };
  });
}

// ---- Leads (newsletter signups) ---------------------------------------------------------------------------------------

export interface ListLeadsInput {
  status?: "subscribed" | "unsubscribed" | undefined;
  source?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/** Newsletter signups from the footer and blog forms, with their source and consent date. Not customers until they order. */
export async function listAdminLeads(rt: Runtime, ctx: TenantContext, input: ListLeadsInput = {}) {
  assertPermission(ctx, "customers.read");
  const limit = Math.min(100, Math.max(1, input.limit ?? 25));
  const offset = Math.max(0, input.offset ?? 0);
  const t = schema.newsletterSubscribers;
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const where = and(
      eq(t.tenantId, ctx.tenantId),
      input.status ? eq(t.status, input.status) : undefined,
      input.source ? eq(t.source, input.source) : undefined,
      input.search?.trim() ? sql`${t.email}::text ILIKE ${`%${input.search.trim()}%`}` : undefined,
    );
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(t).where(where);
    const rows = await tx.select().from(t).where(where).orderBy(desc(t.consentAt)).limit(limit).offset(offset);
    const sources = await tx.selectDistinct({ source: t.source }).from(t).where(eq(t.tenantId, ctx.tenantId));
    return {
      items: rows.map((r) => ({
        id: r.id,
        email: r.email as string,
        status: r.status as "subscribed" | "unsubscribed",
        source: r.source,
        consentAt: r.consentAt.toISOString(),
        unsubscribedAt: r.unsubscribedAt ? r.unsubscribedAt.toISOString() : null,
      })),
      total: count?.n ?? 0,
      sources: sources.map((s) => s.source),
    };
  });
}

/** Unsubscribes a lead through the one consent writer, so the customer record and the consent history stay in step. */
export async function unsubscribeAdminLead(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "customers.write");
  const email = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({ email: schema.newsletterSubscribers.email })
      .from(schema.newsletterSubscribers)
      .where(and(eq(schema.newsletterSubscribers.tenantId, ctx.tenantId), eq(schema.newsletterSubscribers.id, input.id)))
      .limit(1);
    if (!row) throw new Error("Not Found: Lead not found.");
    const [customer] = await tx
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.email, row.email as string)))
      .limit(1);
    return { email: row.email as string, customerId: customer?.id ?? null };
  });
  if (email.customerId) {
    await setMarketingConsent(rt, ctx, { customerId: email.customerId, state: "unsubscribed", source: "admin", channel: "email", actorType: "staff", actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null });
  } else {
    await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
      await tx
        .update(schema.newsletterSubscribers)
        .set({ status: "unsubscribed", unsubscribedAt: new Date() })
        .where(and(eq(schema.newsletterSubscribers.tenantId, ctx.tenantId), eq(schema.newsletterSubscribers.id, input.id)));
      await audit(tx, ctx, "lead.unsubscribed", "lead", input.id, {});
    });
  }
  return { success: true };
}
