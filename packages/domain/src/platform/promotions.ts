import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta, type PlatformRole } from "../platform-services.ts";
import { assertCanTransitionTenant } from "../system/tenant-lifecycle.ts";
import {
  addMonths,
  isValidTerm,
  normalizePromoCode,
  promotionProblem,
  quoteTerm,
  type PromotionKind,
  type PromotionTerms,
  type TermQuote,
} from "../saas/promotion-math.ts";

/**
 * Promotions and free periods (ADR-035, owner decisions 2026-10-17): only the platform owner creates promotions and
 * grants them; a promotion lasts at most 12 months; one active promotion per store; stores keep the promotion if they
 * change plan. Billing itself is not live yet, so a grant records what the store was promised and when it ends; the
 * quote shows what a prepaid term costs. When a free period ends without the store having paid, it is suspended until
 * a plan is chosen.
 */

export interface PromotionView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: PromotionKind;
  percentOff: number | null;
  durationMonths: number;
  appliesToPlanCodes: string[];
  maxRedemptions: number | null;
  redeemedCount: number;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
}

type PromotionRow = typeof schema.promotions.$inferSelect;

function toView(r: PromotionRow): PromotionView {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    kind: r.kind as PromotionKind,
    percentOff: r.percentOff,
    durationMonths: r.durationMonths,
    appliesToPlanCodes: r.appliesToPlanCodes,
    maxRedemptions: r.maxRedemptions,
    redeemedCount: r.redeemedCount,
    validFrom: r.validFrom ? r.validFrom.toISOString() : null,
    validUntil: r.validUntil ? r.validUntil.toISOString() : null,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  };
}

async function assertOwner(rt: Runtime, staffUserId: string, action: string): Promise<void> {
  const staff = await assertPlatformStaff(rt, staffUserId);
  assertRoleAtLeast(staff.role as PlatformRole, "platform_owner", action);
}

export async function listPromotions(rt: Runtime, staffUserId: string): Promise<PromotionView[]> {
  await assertPlatformStaff(rt, staffUserId);
  const rows = await rt._db.db.select().from(schema.promotions).orderBy(desc(schema.promotions.createdAt));
  return rows.map(toView);
}

export interface CreatePromotionInput {
  code: string;
  name: string;
  description?: string | null | undefined;
  kind: PromotionKind;
  percentOff?: number | null | undefined;
  durationMonths: number;
  appliesToPlanCodes?: string[] | undefined;
  maxRedemptions?: number | null | undefined;
  validFrom?: string | null | undefined;
  validUntil?: string | null | undefined;
}

function parseDate(value: string | null | undefined, label: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Bad Request: ${label} is not a valid date`);
  return d;
}

export async function createPromotion(rt: Runtime, staffUserId: string, input: CreatePromotionInput, meta?: AuditMeta): Promise<PromotionView> {
  await assertOwner(rt, staffUserId, "creating promotions");
  const code = normalizePromoCode(input.code);
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("Bad Request: give the promotion a name of up to 80 characters");
  const problem = promotionProblem({ kind: input.kind, percentOff: input.percentOff, durationMonths: input.durationMonths });
  if (problem) throw new Error(`Bad Request: ${problem}`);
  if (input.maxRedemptions != null && (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 1)) throw new Error("Bad Request: the redemption limit must be 1 or more");
  const validFrom = parseDate(input.validFrom, "the start date");
  const validUntil = parseDate(input.validUntil, "the end date");
  if (validFrom && validUntil && validUntil <= validFrom) throw new Error("Bad Request: the end date must be after the start date");

  return rt._db.db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: schema.promotions.id }).from(schema.promotions).where(eq(schema.promotions.code, code)).limit(1);
    if (dup) throw new Error(`Conflict: the promo code ${code} already exists`);
    const [row] = await tx
      .insert(schema.promotions)
      .values({
        code,
        name,
        description: input.description?.trim() || null,
        kind: input.kind,
        percentOff: input.kind === "percent_off" ? (input.percentOff ?? null) : null,
        durationMonths: input.durationMonths,
        appliesToPlanCodes: (input.appliesToPlanCodes ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean),
        maxRedemptions: input.maxRedemptions ?? null,
        validFrom,
        validUntil,
        createdBy: staffUserId,
      })
      .returning();
    if (!row) throw new Error("Failed to create the promotion");
    await writePlatformAudit(tx, staffUserId, "promotion.created", "promotion", row.id, null, { code, kind: row.kind, durationMonths: row.durationMonths, percentOff: row.percentOff }, meta);
    return toView(row);
  });
}

export interface UpdatePromotionInput {
  id: string;
  name?: string | undefined;
  description?: string | null | undefined;
  appliesToPlanCodes?: string[] | undefined;
  maxRedemptions?: number | null | undefined;
  validFrom?: string | null | undefined;
  validUntil?: string | null | undefined;
  isActive?: boolean | undefined;
}

/** What may change after creation: the wording, eligibility window and limits, and whether it is on. Terms never change. */
export async function updatePromotion(rt: Runtime, staffUserId: string, input: UpdatePromotionInput, meta?: AuditMeta): Promise<PromotionView> {
  await assertOwner(rt, staffUserId, "changing promotions");
  return rt._db.db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.promotions).where(eq(schema.promotions.id, input.id)).for("update").limit(1);
    if (!existing) throw new Error("Not Found: promotion not found");

    const patch: Partial<typeof schema.promotions.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name || name.length > 80) throw new Error("Bad Request: give the promotion a name of up to 80 characters");
      patch.name = name;
    }
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.appliesToPlanCodes !== undefined) patch.appliesToPlanCodes = input.appliesToPlanCodes.map((c) => c.trim().toLowerCase()).filter(Boolean);
    if (input.maxRedemptions !== undefined) {
      if (input.maxRedemptions !== null && (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < Math.max(1, existing.redeemedCount))) {
        throw new Error("Bad Request: the redemption limit cannot be below the number already redeemed");
      }
      patch.maxRedemptions = input.maxRedemptions;
    }
    if (input.validFrom !== undefined) patch.validFrom = parseDate(input.validFrom, "the start date");
    if (input.validUntil !== undefined) patch.validUntil = parseDate(input.validUntil, "the end date");
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    const [row] = await tx.update(schema.promotions).set(patch).where(eq(schema.promotions.id, input.id)).returning();
    if (!row) throw new Error("Not Found: promotion not found");
    await writePlatformAudit(tx, staffUserId, "promotion.updated", "promotion", row.id, null, { code: row.code, changed: Object.keys(input).filter((k) => k !== "id") }, meta);
    return toView(row);
  });
}

export interface TenantPromotionView {
  id: string;
  promotionId: string | null;
  promotionCode: string | null;
  kind: PromotionKind;
  percentOff: number | null;
  durationMonths: number;
  planCode: string | null;
  termMonths: number;
  source: "code" | "staff";
  note: string | null;
  status: "active" | "ended" | "cancelled";
  startsAt: string;
  endsAt: string;
}

export async function listTenantPromotions(rt: Runtime, staffUserId: string, tenantId: string): Promise<TenantPromotionView[]> {
  await assertPlatformStaff(rt, staffUserId);
  const rows = await rt._db.db
    .select({ tp: schema.tenantPromotions, code: schema.promotions.code })
    .from(schema.tenantPromotions)
    .leftJoin(schema.promotions, eq(schema.promotions.id, schema.tenantPromotions.promotionId))
    .where(eq(schema.tenantPromotions.tenantId, tenantId))
    .orderBy(desc(schema.tenantPromotions.createdAt));
  return rows.map(({ tp, code }) => ({
    id: tp.id,
    promotionId: tp.promotionId,
    promotionCode: code,
    kind: tp.kind as PromotionKind,
    percentOff: tp.percentOff,
    durationMonths: tp.durationMonths,
    planCode: tp.planCode,
    termMonths: tp.termMonths,
    source: tp.source as "code" | "staff",
    note: tp.note,
    status: tp.status as "active" | "ended" | "cancelled",
    startsAt: tp.startsAt.toISOString(),
    endsAt: tp.endsAt.toISOString(),
  }));
}

/** Whether a promotion can be redeemed with its code right now for this plan. Throws a plain message when it cannot. */
export function assertPromotionRedeemable(p: PromotionRow, planCode: string | null, now: Date): void {
  if (!p.isActive) throw new Error("Bad Request: this promo code is not active");
  if (p.validFrom && now < p.validFrom) throw new Error("Bad Request: this promo code is not valid yet");
  if (p.validUntil && now > p.validUntil) throw new Error("Bad Request: this promo code has expired");
  if (p.maxRedemptions != null && p.redeemedCount >= p.maxRedemptions) throw new Error("Bad Request: this promo code has been fully redeemed");
  if (p.appliesToPlanCodes.length > 0 && (!planCode || !p.appliesToPlanCodes.includes(planCode.toLowerCase()))) {
    throw new Error("Bad Request: this promo code does not apply to the chosen plan");
  }
}

interface GrantArgs {
  tenantId: string;
  terms: PromotionTerms;
  promotion: PromotionRow | null;
  planCode: string | null;
  termMonths: number;
  source: "code" | "staff";
  note?: string | null | undefined;
  grantedBy?: string | undefined;
  now: Date;
}

async function insertGrant(tx: Db, a: GrantArgs) {
  const [active] = await tx
    .select({ id: schema.tenantPromotions.id })
    .from(schema.tenantPromotions)
    .where(and(eq(schema.tenantPromotions.tenantId, a.tenantId), eq(schema.tenantPromotions.status, "active")))
    .limit(1);
  if (active) throw new Error("Conflict: this store already has an active promotion. Cancel it before granting another");

  const [row] = await tx
    .insert(schema.tenantPromotions)
    .values({
      tenantId: a.tenantId,
      promotionId: a.promotion?.id ?? null,
      kind: a.terms.kind,
      percentOff: a.terms.kind === "percent_off" ? (a.terms.percentOff ?? null) : null,
      durationMonths: a.terms.durationMonths,
      planCode: a.planCode,
      termMonths: a.termMonths,
      source: a.source,
      note: a.note?.trim() || null,
      startsAt: a.now,
      endsAt: addMonths(a.now, a.terms.durationMonths),
      grantedBy: a.grantedBy ?? null,
    })
    .returning();
  if (!row) throw new Error("Failed to grant the promotion");
  if (a.promotion) {
    await tx.update(schema.promotions).set({ redeemedCount: sql`${schema.promotions.redeemedCount} + 1`, updatedAt: sql`now()` }).where(eq(schema.promotions.id, a.promotion.id));
  }
  return row;
}

async function currentPlanCode(tx: Db, tenantId: string): Promise<string | null> {
  const res = await tx.execute<{ code: string }>(sql`
    SELECT p.code FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.tenant_id = ${tenantId} AND s.status IN ('active', 'trialing', 'past_due')
     ORDER BY s.created_at DESC LIMIT 1
  `);
  return res.rows[0]?.code ?? null;
}

export interface GrantPromotionInput {
  tenantId: string;
  /** An existing promotion... */
  promotionId?: string | undefined;
  /** ...or custom terms (for example a free year for a partner). Exactly one of the two. */
  custom?: { kind: PromotionKind; percentOff?: number | null | undefined; durationMonths: number } | undefined;
  termMonths: number;
  note?: string | undefined;
}

/** Platform owner only: gives a store a promotion or a free period. Capped at 12 months; one active promotion per store. */
export async function grantPromotion(rt: Runtime, staffUserId: string, input: GrantPromotionInput, meta?: AuditMeta, now: Date = new Date()): Promise<TenantPromotionView> {
  await assertOwner(rt, staffUserId, "granting promotions");
  if ((input.promotionId ? 1 : 0) + (input.custom ? 1 : 0) !== 1) throw new Error("Bad Request: choose a promotion or enter custom terms, not both");
  if (!isValidTerm(input.termMonths)) throw new Error("Bad Request: choose a term of 6, 12 or 36 months");

  const id = await rt._db.db.transaction(async (tx) => {
    const [tenant] = await tx.select({ id: schema.tenants.id, status: schema.tenants.status }).from(schema.tenants).where(eq(schema.tenants.id, input.tenantId)).for("update").limit(1);
    if (!tenant) throw new Error("Not Found: store not found");
    if (["deleted", "deletion_requested"].includes(tenant.status)) throw new Error("Conflict: this store is being deleted");

    let promotion: PromotionRow | null = null;
    let terms: PromotionTerms;
    if (input.promotionId) {
      const [p] = await tx.select().from(schema.promotions).where(eq(schema.promotions.id, input.promotionId)).for("update").limit(1);
      if (!p) throw new Error("Not Found: promotion not found");
      if (!p.isActive) throw new Error("Bad Request: this promotion is not active");
      promotion = p;
      terms = { kind: p.kind as PromotionKind, percentOff: p.percentOff, durationMonths: p.durationMonths };
    } else {
      terms = input.custom as PromotionTerms;
      const problem = promotionProblem(terms);
      if (problem) throw new Error(`Bad Request: ${problem}`);
    }

    const grant = await insertGrant(tx, {
      tenantId: input.tenantId,
      terms,
      promotion,
      planCode: await currentPlanCode(tx, input.tenantId),
      termMonths: input.termMonths,
      source: "staff",
      note: input.note,
      grantedBy: staffUserId,
      now,
    });
    await writePlatformAudit(tx, staffUserId, "promotion.granted", "tenant", input.tenantId, input.tenantId, {
      grantId: grant.id,
      promotionCode: promotion?.code ?? null,
      kind: terms.kind,
      percentOff: terms.percentOff ?? null,
      durationMonths: terms.durationMonths,
      termMonths: input.termMonths,
      endsAt: grant.endsAt.toISOString(),
    }, meta);
    return grant.id;
  });

  const [view] = (await listTenantPromotions(rt, staffUserId, input.tenantId)).filter((g) => g.id === id);
  if (!view) throw new Error("Failed to read the promotion back");
  return view;
}

/** Platform owner only: stops an active promotion early. The store goes back to list price; nothing is suspended. */
export async function cancelTenantPromotion(rt: Runtime, staffUserId: string, input: { id: string; reason?: string | undefined }, meta?: AuditMeta): Promise<{ ok: true }> {
  await assertOwner(rt, staffUserId, "cancelling promotions");
  return rt._db.db.transaction(async (tx) => {
    const [grant] = await tx.select().from(schema.tenantPromotions).where(eq(schema.tenantPromotions.id, input.id)).for("update").limit(1);
    if (!grant) throw new Error("Not Found: promotion grant not found");
    if (grant.status !== "active") throw new Error("Conflict: this promotion is no longer active");
    await tx.update(schema.tenantPromotions).set({ status: "cancelled", endedAt: new Date() }).where(eq(schema.tenantPromotions.id, input.id));
    await writePlatformAudit(tx, staffUserId, "promotion.cancelled", "tenant", grant.tenantId, grant.tenantId, { grantId: grant.id, reason: input.reason ?? null }, meta);
    return { ok: true as const };
  });
}

/**
 * Redeems a promo code for a store being created (signup or staff provisioning). Runs inside the caller's transaction so
 * a bad code stops the signup before anything is created. Returns the grant id.
 */
export async function redeemPromoCodeInTx(
  tx: Db,
  input: { tenantId: string; code: string; planCode: string | null; termMonths?: number | undefined; now?: Date | undefined },
): Promise<string> {
  const code = normalizePromoCode(input.code);
  const now = input.now ?? new Date();
  const [p] = await tx.select().from(schema.promotions).where(eq(schema.promotions.code, code)).for("update").limit(1);
  if (!p) throw new Error("Bad Request: this promo code is not valid");
  assertPromotionRedeemable(p, input.planCode, now);
  const grant = await insertGrant(tx, {
    tenantId: input.tenantId,
    terms: { kind: p.kind as PromotionKind, percentOff: p.percentOff, durationMonths: p.durationMonths },
    promotion: p,
    planCode: input.planCode,
    termMonths: input.termMonths ?? 12,
    source: "code",
    now,
  });
  await tx.insert(schema.platformAuditLogs).values({
    actorType: "system",
    action: "promotion.redeemed",
    targetType: "tenant",
    targetId: input.tenantId,
    tenantId: input.tenantId,
    diff: { grantId: grant.id, code, kind: p.kind, durationMonths: p.durationMonths },
  });
  return grant.id;
}

export interface QuoteInput {
  planCode: string;
  termMonths: number;
  promotionId?: string | undefined;
  custom?: { kind: PromotionKind; percentOff?: number | null | undefined; durationMonths: number } | undefined;
}

/** What a prepaid term costs for a plan, with or without a promotion. A preview for staff: billing is not live yet. */
export async function quotePromotionTerm(rt: Runtime, staffUserId: string, input: QuoteInput): Promise<TermQuote & { planName: string; monthlyPricePaise: number }> {
  await assertPlatformStaff(rt, staffUserId);
  const [plan] = await rt._db.db.select().from(schema.plans).where(eq(schema.plans.code, input.planCode.toLowerCase())).limit(1);
  if (!plan) throw new Error("Not Found: plan not found");
  let promotion: PromotionTerms | null = null;
  if (input.promotionId) {
    const [p] = await rt._db.db.select().from(schema.promotions).where(eq(schema.promotions.id, input.promotionId)).limit(1);
    if (!p) throw new Error("Not Found: promotion not found");
    promotion = { kind: p.kind as PromotionKind, percentOff: p.percentOff, durationMonths: p.durationMonths };
  } else if (input.custom) {
    promotion = input.custom;
  }
  const quote = quoteTerm({ monthlyPricePaise: Number(plan.priceMonthlyPaise), termMonths: input.termMonths, promotion });
  return { ...quote, planName: plan.name, monthlyPricePaise: Number(plan.priceMonthlyPaise) };
}

/**
 * Ends promotions whose time is up (run on a timer by the platform service). A free period that ends while the store
 * has not started paying suspends the store until it chooses a plan (owner decision 2026-10-17); a discount simply
 * returns to list price. Every change is audited. Returns how many ended and how many stores were suspended.
 */
export async function endDuePromotions(rt: Runtime, now: Date = new Date(), limit = 100): Promise<{ ended: number; suspended: number }> {
  const due = await rt._db.db
    .select({ id: schema.tenantPromotions.id })
    .from(schema.tenantPromotions)
    .where(and(eq(schema.tenantPromotions.status, "active"), lte(schema.tenantPromotions.endsAt, now)))
    .orderBy(asc(schema.tenantPromotions.endsAt))
    .limit(limit);

  let ended = 0;
  let suspended = 0;
  for (const { id } of due) {
    await rt._db.db.transaction(async (tx) => {
      const [grant] = await tx.select().from(schema.tenantPromotions).where(eq(schema.tenantPromotions.id, id)).for("update").limit(1);
      if (!grant || grant.status !== "active") return;

      await tx.update(schema.tenantPromotions).set({ status: "ended", endedAt: now }).where(eq(schema.tenantPromotions.id, id));
      ended += 1;

      let didSuspend = false;
      if (grant.kind === "free_months") {
        const [sub] = await tx
          .select({ providerSubscriptionId: schema.subscriptions.providerSubscriptionId })
          .from(schema.subscriptions)
          .where(and(eq(schema.subscriptions.tenantId, grant.tenantId), inArray(schema.subscriptions.status, ["active", "trialing", "past_due"])))
          .orderBy(desc(schema.subscriptions.createdAt))
          .limit(1);
        const paying = Boolean(sub?.providerSubscriptionId);
        const [tenant] = await tx.select({ status: schema.tenants.status }).from(schema.tenants).where(eq(schema.tenants.id, grant.tenantId)).for("update").limit(1);
        if (!paying && tenant) {
          try {
            assertCanTransitionTenant(tenant.status, "suspended");
            await tx
              .update(schema.tenants)
              .set({ status: "suspended", suspendedReason: "Free period ended. Choose a plan to continue.", updatedAt: sql`now()` })
              .where(eq(schema.tenants.id, grant.tenantId));
            didSuspend = true;
            suspended += 1;
          } catch {
            // The store is already suspended, archived or being deleted: nothing to change.
          }
        }
      }
      await tx.insert(schema.platformAuditLogs).values({
        actorType: "system",
        action: "promotion.ended",
        targetType: "tenant",
        targetId: grant.tenantId,
        tenantId: grant.tenantId,
        diff: { grantId: grant.id, kind: grant.kind, suspended: didSuspend },
      });
    });
  }
  return { ended, suspended };
}

export interface PromoCodePreview {
  valid: boolean;
  /** Plain sentence for the signup form: what the code gives, or why it cannot be used. */
  message: string;
}

/**
 * Public, read-only check of a promo code for the signup form (does not redeem or reveal anything beyond what the shopper
 * would be told on redeeming). The caller rate-limits it. Redemption itself still re-checks everything in the transaction.
 */
export async function previewPromoCode(db: Db, input: { code: string; planCode?: string | null | undefined; now?: Date | undefined }): Promise<PromoCodePreview> {
  if (!input.code.trim()) return { valid: false, message: "Enter a promo code." };
  let code: string;
  try {
    code = normalizePromoCode(input.code);
  } catch {
    return { valid: false, message: "This promo code is not valid." }; // wrong shape: same answer as an unknown code
  }
  const [p] = await db.select().from(schema.promotions).where(eq(schema.promotions.code, code)).limit(1);
  if (!p) return { valid: false, message: "This promo code is not valid." };
  try {
    assertPromotionRedeemable(p, input.planCode ?? null, input.now ?? new Date());
  } catch (err) {
    return { valid: false, message: (err instanceof Error ? err.message : "This promo code cannot be used").replace(/^Bad Request: /, "").replace(/^./, (c) => c.toUpperCase()) + "." };
  }
  const months = `${p.durationMonths} month${p.durationMonths === 1 ? "" : "s"}`;
  const plans = p.appliesToPlanCodes.length > 0 ? ` on the ${p.appliesToPlanCodes.join(" or ")} plan` : "";
  return {
    valid: true,
    message: p.kind === "free_months" ? `Valid: ${months} free${plans}.` : `Valid: ${p.percentOff}% off for ${months}${plans}.`,
  };
}
