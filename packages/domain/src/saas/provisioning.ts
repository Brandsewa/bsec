import { loadTrialPolicy } from "../platform/billing-settings.ts";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { QUEUE_NAMES, schema, type Db } from "@bs/db";
import { defaultWeightUnit, type UnitSystem } from "@bs/contracts/units";
import { hashPassword, STORE_PERMISSIONS, SYSTEM_STORE_ROLES } from "@bs/auth";
import { saasDb, type Runtime } from "../runtime.ts";
import { tierForPlan } from "./plan-tiers.ts";
import { buildOwnerInviteUrl, issueOwnerInviteInTx } from "./invite-token.ts";
import { normalizeSubdomainSlug, validateSubdomainFormat } from "./subdomains.ts";
import { defaultFooterMenuItems, defaultHeaderMenuItems } from "../menu-defaults.ts";
import { redeemPromoCodeInTx } from "../platform/promotions.ts";
import { syncDocumentMediaUsages } from "../media/document-usages.ts";

export interface ProvisionOwnerInput {
  email: string;
  name: string;
  password?: string | undefined;
  phone?: string | undefined;
  /** Verified Google identity (signup with Google). The user is created email-verified with no password. */
  google?: { sub: string } | undefined;
}

export interface ProvisionBusinessInput {
  legalName?: string | undefined;
  industry?: string | undefined;
  line1?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  pincode?: string | undefined;
}

/** The template new stores start with: the one flagged `is_signup_default`, else the launch theme, else the oldest published one. */
export async function resolveSignupTemplateCode(tx: Db): Promise<string> {
  const res = await tx.execute<{ code: string }>(sql`
    SELECT code FROM theme_templates
     WHERE is_active = true AND archived_at IS NULL AND published_at IS NOT NULL
     ORDER BY is_signup_default DESC, (code = 'essential-commerce') DESC, published_at ASC
     LIMIT 1;
  `);
  return res.rows[0]?.code ?? "essential-commerce";
}

export interface ProvisionTenantInput {
  storeName: string;
  slug: string;
  owner: ProvisionOwnerInput;
  planCode?: "starter" | "growth" | "pro" | string | undefined;
  /** Country code (ISO2). Sets tenants.country, currency, timezone, locale, unit system, base market and shipping zone. Defaults to 'IN'. */
  country?: string | undefined;
  /** Theme template code. Omitted for self-service signups: the platform's default template is used (`resolveSignupTemplateCode`). */
  themeTemplate?: string | undefined;
  /** Business details collected at signup; they pre-fill Settings, Store details and the tax state. */
  business?: ProvisionBusinessInput | undefined;
  currency?: string | undefined;
  timezone?: string | undefined;
  leadId?: string | undefined;
  source?: "self_service" | "platform_admin" | undefined;
  /** The platform staff member creating the store (platform_admin source): recorded as the actor in the audit log. */
  actorUserId?: string | undefined;
  /** Issue the owner's single-use invite in the SAME transaction (platform-created stores). */
  issueOwnerInvite?: boolean | undefined;
  /**
   * Commercial state of a platform-created store: 'trial' (14 days, then it lapses), 'active' (billed outside the platform, no
   * expiry) or 'comped' (free, no expiry). Self-service signups are always trials.
   */
  subscriptionState?: "trial" | "active" | "comped" | undefined;
  /** A promo code to redeem with this store (ADR-035). A bad code stops the whole provisioning before anything is created. */
  promoCode?: string | undefined;
  /** Test hook to verify mid-transaction rollback of created org/tenant/user/domain */
  _failMidway?: boolean | undefined;
}

export interface ProvisionTenantResult {
  tenantId: string;
  organizationId: string;
  slug: string;
  hostname: string;
  storeUrl: string;
  adminUrl: string;
  ownerId: string;
  subscriptionId: string;
  /** Only when issueOwnerInvite was requested: the raw token (shown once) and its link. */
  ownerInvite?: { inviteId: string; token: string; url: string; expiresAt: Date } | undefined;
}

/**
 * Atomic Tenant Provisioning Engine (PLAN §5.1, §6.4, §7 / ADR-016).
 *
 * Executes the full tenant initialization within a single atomic database transaction.
 * If any table insert fails, the transaction is rolled back completely.
 *
 * Guaranteed completion under 60 seconds server time (tested under 1 second).
 */
export async function provisionTenant(
  rt: Runtime,
  input: ProvisionTenantInput,
): Promise<ProvisionTenantResult> {
  const db = saasDb(rt);

  const rawSlug = input.slug.trim();
  const slug = normalizeSubdomainSlug(rawSlug);
  const formatCheck = validateSubdomainFormat(slug);
  if (!formatCheck.valid) {
    throw new Error(`Invalid store subdomain '${rawSlug}': ${formatCheck.reason}`);
  }

  const storeName = input.storeName.trim() || `${slug.charAt(0).toUpperCase() + slug.slice(1)} Store`;
  const ownerEmail = input.owner.email.trim().toLowerCase();
  const ownerName = input.owner.name.trim() || ownerEmail.split("@")[0] || "Store Owner";
  const planCode = (input.planCode || "starter").toLowerCase();
  const source = input.source || "self_service";

  // Resolve platform country configuration (IN, US, CA from platform_countries)
  const reqCountry = (input.country || "IN").trim().toUpperCase();
  const countryRows = await db
    .select()
    .from(schema.platformCountries)
    .where(eq(schema.platformCountries.iso2, reqCountry))
    .limit(1);
  const pc = countryRows[0];

  const country = pc?.iso2 ?? reqCountry;
  const currency = (input.currency || pc?.defaultCurrency || "INR").toUpperCase();
  const timezone = input.timezone || pc?.defaultTimezone || "Asia/Kolkata";
  const locale = pc?.defaultLocale || (country === "IN" ? "en-IN" : "en-US");
  const unitSystem = (pc?.defaultUnitSystem as UnitSystem) || "metric";
  const weightUnit = defaultWeightUnit(unitSystem);

  const platformDomain = process.env.PLATFORM_DOMAIN?.trim() || "bcom.si";
  const hostname = `${slug}.${platformDomain}`;
  const isLocal = platformDomain.includes("localhost") || platformDomain.includes("127.0.0.1");
  const protocol = isLocal ? "http" : "https";
  const storeUrl = `${protocol}://${hostname}`;
  const adminHost = process.env.ADMIN_HOST?.trim() || (isLocal ? "localhost:5173" : `admin.${platformDomain}`);
  const adminUrl = `${protocol}://${adminHost}`;

  const provisioned = await db.transaction(async (tx) => {
    const templateCode = input.themeTemplate || (await resolveSignupTemplateCode(tx));

    // 1. Verify slug is not already owned by another store
    const existingTenant = await tx.execute<{ id: string }>(sql`
      SELECT id FROM tenants WHERE LOWER(slug) = ${slug} LIMIT 1;
    `);
    if (existingTenant.rows[0]) {
      throw new Error(`Subdomain '${slug}' is already registered to another store.`);
    }

    // 2. Check reserved slugs table
    const reservedSlug = await tx.execute<{ slug: string }>(sql`
      SELECT slug FROM reserved_slugs WHERE slug = ${slug} LIMIT 1;
    `);
    if (reservedSlug.rows[0]) {
      throw new Error(`Subdomain '${slug}' is reserved for platform infrastructure.`);
    }

    // 3. Organization creation
    const [org] = await tx
      .insert(schema.organizations)
      .values({
        name: `${storeName} Organization`,
      })
      .returning({ id: schema.organizations.id });
    if (!org) throw new Error("Failed to create organization record");
    const organizationId = org.id;

    // 4. User creation or reuse (PLAN §4, §7)
    let ownerId: string;
    let isExistingUser = false;
    const existingUser = await tx.execute<{ id: string }>(sql`
      SELECT id FROM users WHERE LOWER(email) = ${ownerEmail} LIMIT 1;
    `);

    if (existingUser.rows[0]) {
      if (source === "self_service") {
        // A stranger must not be able to create stores owned by (or burn the trial quota of) someone else's account.
        throw new Error(
          "An account with this email already exists. Sign in to the store admin to manage your stores, or sign up with a different email.",
        );
      }
      ownerId = existingUser.rows[0].id;
      isExistingUser = true;
    } else {
      const [newUser] = await tx
        .insert(schema.users)
        .values({
          email: ownerEmail,
          name: ownerName,
          phone: input.owner.phone ?? null,
          emailVerified: Boolean(input.owner.google),
        })
        .returning({ id: schema.users.id });
      if (!newUser) throw new Error("Failed to create store owner user");
      ownerId = newUser.id;
    }

    // 5. Tenant creation
    const [tenant] = await tx
      .insert(schema.tenants)
      .values({
        organizationId,
        slug,
        name: storeName,
        ownerUserId: ownerId,
        status: "active",
        country,
        currency,
        timezone,
        locale,
      })
      .returning({ id: schema.tenants.id });
    if (!tenant) throw new Error("Failed to create tenant record");
    const tenantId = tenant.id;

    // 6. Platform Subdomain record in domains table
    await tx.insert(schema.domains).values({
      tenantId,
      hostname,
      type: "subdomain",
      status: "active",
      isPrimary: true,
      sslStatus: "active",
    });

    if (input._failMidway) {
      throw new Error("Simulated mid-transaction failure after org, user, tenant and domain creation");
    }

    // 7. Password Account setup: only for brand new users. An existing user's credentials are never touched here.
    if (!isExistingUser && input.owner.password && input.owner.password.length >= 10) {
      const passwordHash = await hashPassword(input.owner.password);
      await tx.insert(schema.accounts).values({
        id: randomUUID(),
        userId: ownerId,
        accountId: ownerId,
        providerId: "credential",
        password: passwordHash,
      });
    }

    if (!isExistingUser && input.owner.google) {
      await tx.insert(schema.accounts).values({
        id: randomUUID(),
        userId: ownerId,
        accountId: input.owner.google.sub,
        providerId: "google",
      });
    }

    // 8. Roles and Store Owner Membership (using set_config app.tenant_id)
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);

    // System roles
    const [ownerRole] = await tx
      .insert(schema.roles)
      .values({
        tenantId,
        name: "store_owner",
        isSystem: true,
        permissions: [...STORE_PERMISSIONS],
      })
      .returning({ id: schema.roles.id });
    if (!ownerRole) {
      throw new Error("Failed to create store owner role");
    }

    await tx.insert(schema.roles).values({
      tenantId,
      name: "store_admin",
      isSystem: true,
      permissions: [...SYSTEM_STORE_ROLES.store_admin],
    });

    await tx.insert(schema.roles).values({
      tenantId,
      name: "store_finance",
      isSystem: true,
      permissions: [...SYSTEM_STORE_ROLES.store_finance],
    });

    // Membership: if existing user in self-service, mark invited until invite is accepted
    await tx.insert(schema.memberships).values({
      tenantId,
      userId: ownerId,
      roleId: ownerRole.id,
      status: isExistingUser ? "invited" : "active",
    });

    // 9. Store Settings with default COD configuration
    const biz = input.business;
    const businessAddress =
      biz && (biz.line1?.trim() || biz.city?.trim() || biz.state?.trim() || biz.pincode?.trim())
        ? {
            countryCode: country,
            ...(biz.line1?.trim() ? { line1: biz.line1.trim() } : {}),
            ...(biz.city?.trim() ? { city: biz.city.trim() } : {}),
            ...(biz.state?.trim() ? { state: biz.state.trim() } : {}),
            ...(biz.pincode?.trim() ? { pincode: biz.pincode.trim() } : {}),
          }
        : null;
    const orderPrefix = `#${slug.slice(0, 3).toUpperCase()}-`;
    const isIndia = country === "IN";
    await tx.insert(schema.storeSettings).values({
      tenantId,
      storeName,
      legalName: input.business?.legalName?.trim() || storeName,
      address: businessAddress,
      currency,
      timezone,
      unitSystem,
      weightUnit,
      supportEmail: ownerEmail,
      supportPhone: input.owner.phone ?? null,
      orderPrefix,
      checkout: {
        cod: { enabled: isIndia, feePaise: 0 },
        tax: {
          gstin: null,
          sellerState: isIndia ? (input.business?.state?.trim() || null) : null,
          pricesIncludeTax: isIndia,
        },
      },
    });

    // 9b. Base market (ADR-040): every store has exactly one, from its country and currency.
    const baseMarketName = pc?.name ?? (country === "US" ? "United States" : country === "CA" ? "Canada" : country);
    const baseMarketHandle = country.toLowerCase();
    const baseTaxDisplay = isIndia ? "inclusive" : "exclusive";
    const [baseMarket] = await tx
      .insert(schema.markets)
      .values({
        tenantId,
        name: baseMarketName,
        handle: baseMarketHandle,
        isBase: true,
        status: "active",
        currency,
        taxDisplay: baseTaxDisplay,
      })
      .returning({ id: schema.markets.id });
    if (baseMarket) {
      await tx.insert(schema.marketCountries).values({ tenantId, marketId: baseMarket.id, country });
    }

    // 10. Default Warehouse Location
    await tx
      .insert(schema.locations)
      .values({
        tenantId,
        name: "Main Warehouse",
        isDefault: true,
      });

    // 11. Default Flat Shipping Zone & Rates (PLAN §5.4 / M7 / ADR-040)
    const zoneName = isIndia ? "India (All States & UTs)" : `${baseMarketName} (National)`;
    const [shippingZone] = await tx
      .insert(schema.shippingZones)
      .values({
        tenantId,
        name: zoneName,
        countries: [country],
        isDefault: true,
        marketId: baseMarket?.id ?? null,
      })
      .returning({ id: schema.shippingZones.id });

    if (shippingZone) {
      // Sensible default shipping rates per country & currency (minor units: paise / cents)
      let standardRatePrice = 9900;
      let freeRateThreshold = 99900;
      let freeRateLabel = "Free Shipping on orders above ₹999";

      if (currency === "USD") {
        standardRatePrice = 500; // $5.00
        freeRateThreshold = 5000; // $50.00
        freeRateLabel = "Free Shipping on orders above $50";
      } else if (currency === "CAD") {
        standardRatePrice = 700; // $7.00 CAD
        freeRateThreshold = 7500; // $75.00 CAD
        freeRateLabel = "Free Shipping on orders above $75";
      } else if (!isIndia) {
        standardRatePrice = 1000;
        freeRateThreshold = 10000;
        freeRateLabel = `Free Shipping on qualifying orders`;
      }

      // Standard Flat Rate
      await tx.insert(schema.shippingRates).values({
        tenantId,
        zoneId: shippingZone.id,
        name: "Standard Shipping",
        method: "standard",
        rateType: "flat",
        pricePaise: standardRatePrice,
        minDays: 3,
        maxDays: 7,
      });

      // Free Shipping above threshold
      await tx.insert(schema.shippingRates).values({
        tenantId,
        zoneId: shippingZone.id,
        name: freeRateLabel,
        method: "standard",
        rateType: "free_above_threshold",
        pricePaise: 0,
        thresholdPaise: freeRateThreshold,
        minDays: 3,
        maxDays: 7,
      });
    }

    // 12. Size Tier Allocation (PLAN §6.1)
    const initialTier = tierForPlan(planCode);
    await tx.insert(schema.tenantSizeTiers).values({
      tenantId,
      tier: initialTier,
    });

    // 13. Subscription Record (14-day free trial on chosen plan)
    const planRow = await tx.execute<{ id: string }>(sql`
      SELECT id FROM plans WHERE code = ${planCode} LIMIT 1;
    `);
    const planId = planRow.rows[0]?.id ?? null;

    const subscriptionState = source === "self_service" ? "trial" : (input.subscriptionState ?? "trial");
    // The trial length is a platform setting (Super Admin, Platform billing). With the trial off the end is "now", so the store is
    // on the restricted tier (the trial sweep) until it pays.
    const trialDays = (await loadTrialPolicy(tx)).effectiveDays;
    const trialEnd = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
    const [sub] = await tx
      .insert(schema.subscriptions)
      .values({
        tenantId,
        planId,
        status: subscriptionState === "trial" ? "trialing" : "active",
        interval: "monthly",
        currentPeriodStart: new Date(),
        // Trials lapse after the configured days (14 by default); manually billed and comped stores have no automatic expiry.
        currentPeriodEnd: subscriptionState === "trial" ? trialEnd : null,
        // With the trial off, a self-service signup has to pay before the store opens (admin "Activate your store").
        paymentRequired: subscriptionState === "trial" && source === "self_service" && trialDays === 0,
        provider: subscriptionState === "trial" ? "razorpay" : subscriptionState === "comped" ? "comped" : "manual",
      })
      .returning({ id: schema.subscriptions.id });
    if (!sub) {
      throw new Error("Failed to create subscription record");
    }

    if (input.promoCode?.trim()) {
      await redeemPromoCodeInTx(tx, { tenantId, code: input.promoCode, planCode });
    }

    // 14. Onboarding Progress Checklist (PLAN §5.2, §8)
    await tx.insert(schema.onboardingProgress).values({
      tenantId,
      steps: {
        store_created: true,
        product_added: false,
        payment_configured: false,
        domain_connected: false,
        first_order_received: false,
      },
    });

    // 15. Starter Theme & Content Setup (PLAN §5.1, §7, ADR-009)
    const templateRow = await tx.execute<{
      name: string;
      default_tokens: Record<string, unknown>;
      default_pages: { home?: unknown[] };
    }>(sql`
      SELECT name, default_tokens, default_pages
      FROM theme_templates
      WHERE code = ${templateCode}
      LIMIT 1;
    `);

    const defaultTokens = templateRow.rows[0]?.default_tokens ?? {};
    const defaultPages = templateRow.rows[0]?.default_pages ?? {};

    await tx.insert(schema.themes).values({
      tenantId,
      templateCode,
      name: templateRow.rows[0]?.name ?? "Minimalist Essential",
      tokens: defaultTokens,
      status: "published",
      publishedAt: new Date(),
    });

    // Starter Home Page with blocks and page version (ADR-009)
    const homeBlocks = (defaultPages.home as unknown[]) ?? [
      {
        id: "b-hero-01",
        type: "Hero",
        version: 1,
        props: {
          title: `Welcome to ${storeName}`,
          subtitle: "Explore our premium handcrafted collections.",
          buttonText: "Shop Catalog",
          buttonUrl: "/categories",
        },
      },
      {
        id: "b-grid-01",
        type: "ProductGrid",
        version: 1,
        props: {
          title: "Featured Products",
          limit: 8,
        },
      },
    ];

    const [homePage] = await tx
      .insert(schema.pages)
      .values({
        tenantId,
        type: "home",
        title: "Home",
        slug: "home",
        status: "published",
      })
      .returning({ id: schema.pages.id });

    if (homePage) {
      const [homeVersion] = await tx
        .insert(schema.pageVersions)
        .values({
          tenantId,
          pageId: homePage.id,
          document: { blocks: homeBlocks },
          createdBy: ownerId,
          note: "Initial template setup",
        })
        .returning({ id: schema.pageVersions.id });

      if (homeVersion) {
        await tx
          .update(schema.pages)
          .set({
            publishedVersionId: homeVersion.id,
            draftVersionId: homeVersion.id,
          })
          .where(eq(schema.pages.id, homePage.id));

        const provCtx = {
          tenantId,
          actor: { type: "system" as const, role: "platform_admin" as const },
        };
        await syncDocumentMediaUsages(
          tx,
          provCtx,
          {
            ownerType: "page",
            ownerId: homePage.id,
            field: "published",
            document: { blocks: homeBlocks },
          },
          { tolerant: true },
        );
        await syncDocumentMediaUsages(
          tx,
          provCtx,
          {
            ownerType: "page",
            ownerId: homePage.id,
            field: "draft",
            document: { blocks: homeBlocks },
          },
          { tolerant: true },
        );
      }
    }

    // Starter About Us Page
    const [aboutPage] = await tx
      .insert(schema.pages)
      .values({
        tenantId,
        type: "custom",
        title: "About Us",
        slug: "about",
        status: "published",
      })
      .returning({ id: schema.pages.id });

    if (aboutPage) {
      const [aboutVersion] = await tx
        .insert(schema.pageVersions)
        .values({
          tenantId,
          pageId: aboutPage.id,
          document: {
            blocks: [
              {
                id: "b-about-01",
                type: "Content",
                version: 1,
                props: {
                  heading: `About ${storeName}`,
                  body: `Welcome to ${storeName}. We craft high-quality products with passion and attention to detail.`,
                },
              },
            ],
          },
          createdBy: ownerId,
          note: "Starter About page",
        })
        .returning({ id: schema.pageVersions.id });

      if (aboutVersion) {
        await tx
          .update(schema.pages)
          .set({
            publishedVersionId: aboutVersion.id,
            draftVersionId: aboutVersion.id,
          })
          .where(eq(schema.pages.id, aboutPage.id));

        const provCtx = {
          tenantId,
          actor: { type: "system" as const, role: "platform_admin" as const },
        };
        await syncDocumentMediaUsages(
          tx,
          provCtx,
          {
            ownerType: "page",
            ownerId: aboutPage.id,
            field: "published",
            document: {
              blocks: [
                {
                  id: "b-about-01",
                  type: "Content",
                  version: 1,
                  props: {
                    heading: `About ${storeName}`,
                    body: `Welcome to ${storeName}. We craft high-quality products with passion and attention to detail.`,
                  },
                },
              ],
            },
          },
          { tolerant: true },
        );
        await syncDocumentMediaUsages(
          tx,
          provCtx,
          {
            ownerType: "page",
            ownerId: aboutPage.id,
            field: "draft",
            document: {
              blocks: [
                {
                  id: "b-about-01",
                  type: "Content",
                  version: 1,
                  props: {
                    heading: `About ${storeName}`,
                    body: `Welcome to ${storeName}. We craft high-quality products with passion and attention to detail.`,
                  },
                },
              ],
            },
          },
          { tolerant: true },
        );
      }
    }

    // Starter Privacy Policy Page (/policies/privacy)
    const [privacyPage] = await tx
      .insert(schema.pages)
      .values({
        tenantId,
        type: "custom",
        title: "Privacy Policy",
        slug: "privacy",
        status: "published",
      })
      .returning({ id: schema.pages.id });

    if (privacyPage) {
      const [privacyVersion] = await tx
        .insert(schema.pageVersions)
        .values({
          tenantId,
          pageId: privacyPage.id,
          document: {
            blocks: [
              {
                id: "b-privacy-01",
                type: "Content",
                version: 1,
                props: {
                  heading: "Privacy Policy",
                  body: `This Privacy Policy describes how ${storeName} collects, uses, and discloses your personal data when you visit our store or make a purchase.`,
                },
              },
            ],
          },
          createdBy: ownerId,
          note: "Starter Privacy Policy page",
        })
        .returning({ id: schema.pageVersions.id });

      if (privacyVersion) {
        await tx
          .update(schema.pages)
          .set({
            publishedVersionId: privacyVersion.id,
            draftVersionId: privacyVersion.id,
          })
          .where(eq(schema.pages.id, privacyPage.id));

        const provCtx = {
          tenantId,
          actor: { type: "system" as const, role: "platform_admin" as const },
        };
        await syncDocumentMediaUsages(
          tx,
          provCtx,
          {
            ownerType: "page",
            ownerId: privacyPage.id,
            field: "published",
            document: {
              blocks: [
                {
                  id: "b-privacy-01",
                  type: "Content",
                  version: 1,
                  props: {
                    heading: "Privacy Policy",
                    body: `This Privacy Policy describes how ${storeName} collects, uses, and discloses your personal data when you visit our store or make a purchase.`,
                  },
                },
              ],
            },
          },
          { tolerant: true },
        );
        await syncDocumentMediaUsages(
          tx,
          provCtx,
          {
            ownerType: "page",
            ownerId: privacyPage.id,
            field: "draft",
            document: {
              blocks: [
                {
                  id: "b-privacy-01",
                  type: "Content",
                  version: 1,
                  props: {
                    heading: "Privacy Policy",
                    body: `This Privacy Policy describes how ${storeName} collects, uses, and discloses your personal data when you visit our store or make a purchase.`,
                  },
                },
              ],
            },
          },
          { tolerant: true },
        );
      }
    }

    // Starter Terms of Service Page (/policies/terms)
    const [termsPage] = await tx
      .insert(schema.pages)
      .values({
        tenantId,
        type: "custom",
        title: "Terms of Service",
        slug: "terms",
        status: "published",
      })
      .returning({ id: schema.pages.id });

    if (termsPage) {
      const [termsVersion] = await tx
        .insert(schema.pageVersions)
        .values({
          tenantId,
          pageId: termsPage.id,
          document: {
            blocks: [
              {
                id: "b-terms-01",
                type: "Content",
                version: 1,
                props: {
                  heading: "Terms of Service",
                  body: `By visiting our site or purchasing from ${storeName}, you agree to be bound by these Terms of Service.`,
                },
              },
            ],
          },
          createdBy: ownerId,
          note: "Starter Terms of Service page",
        })
        .returning({ id: schema.pageVersions.id });

      if (termsVersion) {
        await tx
          .update(schema.pages)
          .set({
            publishedVersionId: termsVersion.id,
            draftVersionId: termsVersion.id,
          })
          .where(eq(schema.pages.id, termsPage.id));

        const provCtx = {
          tenantId,
          actor: { type: "system" as const, role: "platform_admin" as const },
        };
        await syncDocumentMediaUsages(
          tx,
          provCtx,
          {
            ownerType: "page",
            ownerId: termsPage.id,
            field: "published",
            document: {
              blocks: [
                {
                  id: "b-terms-01",
                  type: "Content",
                  version: 1,
                  props: {
                    heading: "Terms of Service",
                    body: `By visiting our site or purchasing from ${storeName}, you agree to be bound by these Terms of Service.`,
                  },
                },
              ],
            },
          },
          { tolerant: true },
        );
        await syncDocumentMediaUsages(
          tx,
          provCtx,
          {
            ownerType: "page",
            ownerId: termsPage.id,
            field: "draft",
            document: {
              blocks: [
                {
                  id: "b-terms-01",
                  type: "Content",
                  version: 1,
                  props: {
                    heading: "Terms of Service",
                    body: `By visiting our site or purchasing from ${storeName}, you agree to be bound by these Terms of Service.`,
                  },
                },
              ],
            },
          },
          { tolerant: true },
        );
      }
    }

    // Navigation Menus (Header & Footer): full items with ids and types so the admin editor can open them.
    await tx.insert(schema.menus).values([
      { tenantId, handle: "header", title: "Main menu", items: defaultHeaderMenuItems() },
      { tenantId, handle: "footer", title: "Footer menu", items: defaultFooterMenuItems() },
    ]);

    // 16. Cleanup any slug reservation
    await tx.execute(sql`
      DELETE FROM slug_reservations WHERE slug = ${slug};
    `);

    // 17. Record Platform Audit Log
    await tx.insert(schema.platformAuditLogs).values({
      actorUserId: source === "self_service" ? ownerId : (input.actorUserId ?? null),
      actorType: source === "self_service" ? "system" : "platform_staff",
      action: "tenant.provisioned",
      targetType: "tenant",
      targetId: tenantId,
      tenantId,
      diff: {
        slug,
        storeName,
        planCode,
        templateCode,
        ownerEmail,
        source,
      },
    });

    let ownerInvite: ProvisionTenantResult["ownerInvite"];
    if (input.issueOwnerInvite) {
      const issued = await issueOwnerInviteInTx(tx, { tenantId, email: ownerEmail, invitedBy: input.actorUserId });
      ownerInvite = { inviteId: issued.inviteId, token: issued.rawToken, url: buildOwnerInviteUrl(issued.rawToken), expiresAt: issued.expiresAt };
    }

    return {
      tenantId,
      organizationId,
      slug,
      hostname,
      storeUrl,
      adminUrl,
      ownerId,
      subscriptionId: sub.id,
      ownerInvite,
    };
  });

  // Tell Super Admin staff about the new store (after commit, ADR-006). A failure to enqueue never undoes the store.
  try {
    await rt._jobs?.send(QUEUE_NAMES.NOTIFICATION_DISPATCH, {
      eventKey: "platform_store_signup",
      tenantId: provisioned.tenantId,
      eventRef: `platform_store_signup_${provisioned.tenantId}`,
      title: `New store: ${storeName}`,
      body: `${ownerEmail} created ${provisioned.hostname} on the ${planCode} plan.`,
      emailLines: [`${storeName} (${provisioned.hostname}) was created for ${ownerEmail} on the ${planCode} plan.`],
      link: `/tenants/${provisioned.tenantId}`,
      ctaLabel: "Open store",
    });
  } catch {
    // The store exists; the alert is best effort.
  }
  return provisioned;
}
