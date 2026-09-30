import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import {
  assertTrialStoreLimit,
  checkSignupRateLimit,
  isDisposableEmail,
  verifyTurnstileToken,
} from "./abuse-protection.ts";
import {
  normalizeSubdomainSlug,
  verifySubdomainReservation,
} from "./subdomains.ts";
import { provisionTenant, type ProvisionTenantResult } from "./provisioning.ts";

export interface SaveSignupLeadInput {
  leadId?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  name?: string | undefined;
  businessName?: string | undefined;
  desiredSlug?: string | undefined;
  industry?: string | undefined;
  source?: string | undefined;
  utm?: Record<string, string> | undefined;
  referralCode?: string | undefined;
  step?: "started" | "subdomain_selected" | "basics_entered" | "credentials_entered" | "template_chosen" | "plan_chosen" | "store_created" | "abandoned" | undefined;
  ipHash?: string | undefined;
}

export interface CompleteSignupInput {
  leadId?: string | undefined;
  storeName: string;
  slug: string;
  owner: {
    email: string;
    name: string;
    password?: string | undefined;
    phone?: string | undefined;
  };
  planCode?: "starter" | "growth" | "pro" | string | undefined;
  themeTemplate?: "starter-minimal" | "fashion-editorial" | "gourmet-artisan" | string | undefined;
  currency?: string | undefined;
  timezone?: string | undefined;
  turnstileToken?: string | undefined;
  clientIp?: string | undefined;
}

/**
 * Saves or updates a signup lead capturing incremental wizard progress (PLAN §5.2, §7).
 */
export async function saveSignupLead(
  db: Db,
  input: SaveSignupLeadInput,
): Promise<{ leadId: string }> {
  const normSlug = input.desiredSlug ? normalizeSubdomainSlug(input.desiredSlug) : undefined;
  const normEmail = input.email ? input.email.trim().toLowerCase() : undefined;

  if (input.leadId) {
    await db
      .update(schema.signupLeads)
      .set({
        email: normEmail,
        phone: input.phone?.trim() ?? undefined,
        name: input.name?.trim() ?? undefined,
        businessName: input.businessName?.trim() ?? undefined,
        desiredSlug: normSlug,
        industry: input.industry?.trim() ?? undefined,
        source: input.source?.trim() ?? undefined,
        utm: input.utm ?? undefined,
        referralCode: input.referralCode?.trim() ?? undefined,
        step: input.step ?? "started",
        ipHash: input.ipHash,
        updatedAt: new Date(),
      })
      .where(eq(schema.signupLeads.id, input.leadId));

    return { leadId: input.leadId };
  }

  const [created] = await db
    .insert(schema.signupLeads)
    .values({
      email: normEmail,
      phone: input.phone?.trim() ?? null,
      name: input.name?.trim() ?? null,
      businessName: input.businessName?.trim() ?? null,
      desiredSlug: normSlug,
      industry: input.industry?.trim() ?? null,
      source: input.source?.trim() ?? null,
      utm: input.utm ?? {},
      referralCode: input.referralCode?.trim() ?? null,
      step: input.step ?? "started",
      ipHash: input.ipHash ?? null,
    })
    .returning({ id: schema.signupLeads.id });

  if (!created) throw new Error("Failed to create signup lead");
  return { leadId: created.id };
}

/**
 * Executes the complete 6-step self-service merchant signup pipeline (PLAN §7).
 *
 * Sequence:
 * 1. Abuse & Rate limit check (IP & Email)
 * 2. Disposable email check
 * 3. Turnstile bot challenge verification
 * 4. Max 3 trial stores enforcement
 * 5. Subdomain reservation & availability verification
 * 6. Atomic Tenant Provisioning
 * 7. Mark lead as converted
 */
export async function completeSignup(
  rt: Runtime,
  input: CompleteSignupInput,
): Promise<ProvisionTenantResult> {
  const db = rt._db.db;
  const clientIp = input.clientIp || "127.0.0.1";
  const email = input.owner.email.trim().toLowerCase();

  // 1. Abuse: Rate limiting (5/hr IP, 3/hr email)
  const rateLimit = await checkSignupRateLimit(db, clientIp, email);
  if (!rateLimit.allowed) {
    throw new Error(
      `Too many signup attempts. Please try again in ${Math.ceil((rateLimit.retryAfter ?? 300) / 60)} minutes.`,
    );
  }

  // 2. Abuse: Disposable email check
  if (isDisposableEmail(email)) {
    throw new Error("Temporary or disposable email addresses are not permitted. Please use your business or personal email.");
  }

  // 3. Abuse: Turnstile verification (provider adapter)
  const turnstile = await verifyTurnstileToken(input.turnstileToken, clientIp);
  if (!turnstile.success) {
    throw new Error(turnstile.reason || "Security verification failed. Please complete the captcha challenge.");
  }

  // 4. Abuse: Max 3 trial stores per user email
  await assertTrialStoreLimit(db, email);

  // 5. Verify Subdomain reservation or availability
  const normSlug = normalizeSubdomainSlug(input.slug);
  const isAvailable = await verifySubdomainReservation(db, normSlug, input.leadId);
  if (!isAvailable) {
    throw new Error(`Subdomain '${normSlug}' is unavailable or reserved by another merchant.`);
  }

  // 6. Atomic Tenant Provisioning
  const provisionResult = await provisionTenant(rt, {
    storeName: input.storeName,
    slug: normSlug,
    owner: {
      email,
      name: input.owner.name,
      password: input.owner.password,
      phone: input.owner.phone,
    },
    planCode: input.planCode || "starter",
    themeTemplate: input.themeTemplate || "starter-minimal",
    currency: input.currency || "INR",
    timezone: input.timezone || "Asia/Kolkata",
    leadId: input.leadId,
    source: "self_service",
  });

  // 7. Update signup lead to store_created if leadId provided
  if (input.leadId) {
    try {
      await db
        .update(schema.signupLeads)
        .set({
          step: "store_created",
          updatedAt: new Date(),
        })
        .where(eq(schema.signupLeads.id, input.leadId));
    } catch {
      // Non-fatal if lead status update fails after successful store provisioning
    }
  }

  return provisionResult;
}

export interface PublicPlan {
  id: string;
  code: string;
  name: string;
  priceMonthlyPaise: number;
  priceYearlyPaise: number;
  currency: string;
  limits: Record<string, unknown>;
  features: Record<string, unknown>;
  sort: number;
}

export interface PublicThemeTemplate {
  id: string;
  code: string;
  name: string;
  industry: string;
  previewImageKey: string | null;
}

export async function listPublicPlans(db: Db): Promise<PublicPlan[]> {
  const res = await db.execute<{
    id: string;
    code: string;
    name: string;
    price_monthly_paise: number;
    price_yearly_paise: number;
    currency: string;
    limits: Record<string, unknown>;
    features: Record<string, unknown>;
    sort: number;
  }>(sql`
    SELECT id, code, name, price_monthly_paise, price_yearly_paise, currency, limits, features, sort
    FROM plans
    WHERE is_public = true
    ORDER BY sort ASC;
  `);
  return res.rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    priceMonthlyPaise: Number(r.price_monthly_paise),
    priceYearlyPaise: Number(r.price_yearly_paise),
    currency: r.currency,
    limits: r.limits,
    features: r.features,
    sort: r.sort,
  }));
}

export async function listPublicThemeTemplates(db: Db): Promise<PublicThemeTemplate[]> {
  const res = await db.execute<{
    id: string;
    code: string;
    name: string;
    industry: string;
    preview_image_key: string | null;
  }>(sql`
    SELECT id, code, name, industry, preview_image_key
    FROM theme_templates
    WHERE is_active = true
    ORDER BY code ASC;
  `);
  return res.rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    industry: r.industry,
    previewImageKey: r.preview_image_key,
  }));
}

