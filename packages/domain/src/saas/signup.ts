import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import { saasDb, type Runtime } from "../runtime.ts";
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
import { readGoogleSignupTicket } from "./google-signup.ts";
import { renderCompareCell, renderPlanBullet, type PlanBullet, type PlanCell, type PlanLimitValues, type PublicPlanCompareGroup } from "@bs/contracts";
import { loadEnforcedPlanLimits } from "../platform/plan-editor.ts";
import { provisionTenant, type ProvisionBusinessInput, type ProvisionTenantResult } from "./provisioning.ts";

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
    /** Ticket from verifyGoogleForSignup. Replaces the password and fixes the owner email to the verified one. */
    googleTicket?: string | undefined;
  };
  planCode?: "starter" | "growth" | "pro" | string | undefined;
  country?: string | undefined;
  business?: ProvisionBusinessInput | undefined;
  currency?: string | undefined;
  timezone?: string | undefined;
  turnstileToken?: string | undefined;
  clientIp?: string | undefined;
  /** Optional promo code (ADR-035). */
  promoCode?: string | undefined;
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
  const db = saasDb(rt);
  const clientIp = input.clientIp || "127.0.0.1";
  let email = input.owner.email.trim().toLowerCase();
  let googleSub: string | undefined;
  let ownerName = input.owner.name;
  if (input.owner.googleTicket) {
    const secret = process.env.BETTER_AUTH_SECRET?.trim();
    const ticket = secret ? readGoogleSignupTicket(secret, input.owner.googleTicket) : null;
    if (!ticket) throw new Error("Your Google sign-in expired. Please continue with Google again.");
    // The email is the one Google verified, whatever the client sent.
    email = ticket.email;
    googleSub = ticket.sub;
    ownerName = input.owner.name?.trim() || ticket.name;
  }

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
      name: ownerName,
      ...(googleSub ? { google: { sub: googleSub } } : { password: input.owner.password }),
      phone: input.owner.phone,
    },
    planCode: input.planCode || "starter",
    country: input.country,
    business: input.business,
    currency: input.currency,
    timezone: input.timezone,
    leadId: input.leadId,
    source: "self_service",
    promoCode: input.promoCode,
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
  priceMonthlyUsdCents: number | null;
  priceYearlyUsdCents: number | null;
  currency: string;
  limits: Record<string, unknown>;
  features: Record<string, unknown>;
  sort: number;
  tagline: string | null;
  audience: string | null;
  badge: string | null;
  /** The card lines, with every linked limit already filled in from what is enforced. */
  bullets: string[];
}

export interface PublicThemeTemplate {
  id: string;
  code: string;
  name: string;
  industry: string;
  previewImageKey: string | null;
}

export interface PublicPlatformCountry {
  iso2: string;
  name: string;
  defaultCurrency: string;
  defaultLocale: string;
  defaultTimezone: string;
  defaultUnitSystem: string;
  addressSchema: string;
  sort: number;
}

export async function listPublicPlans(db: Db): Promise<PublicPlan[]> {
  const res = await db.execute<{
    id: string;
    code: string;
    name: string;
    price_monthly_paise: number;
    price_yearly_paise: number;
    price_monthly_usd_cents: number | null;
    price_yearly_usd_cents: number | null;
    currency: string;
    limits: Record<string, unknown>;
    features: Record<string, unknown>;
    sort: number;
    tagline: string | null;
    audience: string | null;
    badge: string | null;
    card_bullets: unknown;
  }>(sql`
    SELECT id, code, name, price_monthly_paise, price_yearly_paise, price_monthly_usd_cents, price_yearly_usd_cents, currency, limits, features, sort, tagline, audience, badge, card_bullets
    FROM plans
    WHERE is_public = true
    ORDER BY sort ASC;
  `);
  // The numbers customers see are the ones enforced (size tier), not the copy in plans.limits.
  const enforced = await loadEnforcedPlanLimits(db, res.rows);
  return res.rows.map((r) => {
    const limits = enforced.get(r.code) ?? {};
    const bullets = (Array.isArray(r.card_bullets) ? (r.card_bullets as PlanBullet[]) : [])
      .map((b) => renderPlanBullet(b, limits))
      .filter((t): t is string => Boolean(t));
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      priceMonthlyPaise: Number(r.price_monthly_paise),
      priceYearlyPaise: Number(r.price_yearly_paise),
      priceMonthlyUsdCents: r.price_monthly_usd_cents === null || r.price_monthly_usd_cents === undefined ? null : Number(r.price_monthly_usd_cents),
      priceYearlyUsdCents: r.price_yearly_usd_cents === null || r.price_yearly_usd_cents === undefined ? null : Number(r.price_yearly_usd_cents),
      currency: r.currency,
      limits: { ...(r.limits ?? {}), ...limits },
      features: r.features,
      sort: r.sort,
      tagline: r.tagline,
      audience: r.audience,
      badge: r.badge,
      bullets,
    };
  });
}

/** The long comparison table, grouped, with every limit row showing the enforced value for each public plan. */
export async function listPublicPlanCompare(db: Db): Promise<{ plans: Array<{ code: string; name: string }>; groups: PublicPlanCompareGroup[] }> {
  const plans = await listPublicPlans(db);
  const rows = await db.execute<{ group_name: string; label: string; tooltip: string | null; limit_key: string | null; cells: Record<string, PlanCell> }>(sql`
    SELECT group_name, label, tooltip, limit_key, cells FROM plan_compare_rows WHERE is_visible = true ORDER BY sort ASC, created_at ASC;
  `);
  const groups: PublicPlanCompareGroup[] = [];
  for (const r of rows.rows) {
    let g = groups.find((x) => x.groupName === r.group_name);
    if (!g) groups.push((g = { groupName: r.group_name, rows: [] }));
    const cells: Record<string, PlanCell> = {};
    for (const p of plans) cells[p.code] = renderCompareCell({ limitKey: r.limit_key, cells: r.cells ?? {} }, p.code, p.limits as PlanLimitValues);
    g.rows.push({ label: r.label, tooltip: r.tooltip, cells });
  }
  return { plans: plans.map((p) => ({ code: p.code, name: p.name })), groups };
}

export async function listPlatformCountries(db: Db): Promise<PublicPlatformCountry[]> {
  const res = await db.execute<{
    iso2: string;
    name: string;
    default_currency: string;
    default_locale: string;
    default_timezone: string;
    default_unit_system: string;
    address_schema: string;
    sort: number;
  }>(sql`
    SELECT iso2, name, default_currency, default_locale, default_timezone, default_unit_system, address_schema, sort
    FROM platform_countries
    WHERE enabled = true
    ORDER BY sort ASC, iso2 ASC;
  `);
  return res.rows.map((r) => ({
    iso2: r.iso2,
    name: r.name,
    defaultCurrency: r.default_currency,
    defaultLocale: r.default_locale,
    defaultTimezone: r.default_timezone,
    defaultUnitSystem: r.default_unit_system,
    addressSchema: r.address_schema,
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

