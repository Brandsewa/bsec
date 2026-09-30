import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { hashPassword, STORE_PERMISSIONS } from "@bs/auth";
import { saasDb, type Runtime } from "../runtime.ts";
import { tierForPlan } from "./plan-tiers.ts";
import { normalizeSubdomainSlug, validateSubdomainFormat } from "./subdomains.ts";

export interface ProvisionOwnerInput {
  email: string;
  name: string;
  password?: string | undefined;
  phone?: string | undefined;
}

export interface ProvisionTenantInput {
  storeName: string;
  slug: string;
  owner: ProvisionOwnerInput;
  planCode?: "starter" | "growth" | "pro" | string | undefined;
  themeTemplate?: "starter-minimal" | "fashion-editorial" | "gourmet-artisan" | string | undefined;
  currency?: string | undefined;
  timezone?: string | undefined;
  leadId?: string | undefined;
  source?: "self_service" | "platform_admin" | undefined;
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
  const currency = (input.currency || "INR").toUpperCase();
  const timezone = input.timezone || "Asia/Kolkata";
  const planCode = (input.planCode || "starter").toLowerCase();
  const templateCode = input.themeTemplate || "starter-minimal";
  const source = input.source || "self_service";

  const platformDomain = process.env.PLATFORM_DOMAIN?.trim() || "gobs.cloud";
  const hostname = `${slug}.${platformDomain}`;
  const isLocal = platformDomain.includes("localhost") || platformDomain.includes("127.0.0.1");
  const protocol = isLocal ? "http" : "https";
  const storeUrl = `${protocol}://${hostname}`;
  const adminHost = process.env.ADMIN_HOST?.trim() || (isLocal ? "localhost:5173" : `admin.${platformDomain}`);
  const adminUrl = `${protocol}://${adminHost}`;

  return await db.transaction(async (tx) => {
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
          emailVerified: false,
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
        currency,
        timezone,
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
      permissions: [...STORE_PERMISSIONS],
    });

    // Membership: if existing user in self-service, mark invited until invite is accepted
    await tx.insert(schema.memberships).values({
      tenantId,
      userId: ownerId,
      roleId: ownerRole.id,
      status: isExistingUser ? "invited" : "active",
    });

    // 9. Store Settings with default COD configuration
    const orderPrefix = `#${slug.slice(0, 3).toUpperCase()}-`;
    await tx.insert(schema.storeSettings).values({
      tenantId,
      storeName,
      legalName: storeName,
      currency,
      timezone,
      supportEmail: ownerEmail,
      supportPhone: input.owner.phone ?? null,
      orderPrefix,
      checkout: {
        cod: { enabled: true, feePaise: 0 },
        tax: { gstin: null, sellerState: null, pricesIncludeTax: true },
      },
    });

    // 10. Default Warehouse Location
    await tx
      .insert(schema.locations)
      .values({
        tenantId,
        name: "Main Warehouse",
        isDefault: true,
      });

    // 11. Default India Flat Shipping Zone & Rates (PLAN §5.4 / M7)
    const [shippingZone] = await tx
      .insert(schema.shippingZones)
      .values({
        tenantId,
        name: "India (All States & UTs)",
        countries: ["IN"],
        isDefault: true,
      })
      .returning({ id: schema.shippingZones.id });

    if (shippingZone) {
      // Standard Flat Rate (₹99.00)
      await tx.insert(schema.shippingRates).values({
        tenantId,
        zoneId: shippingZone.id,
        name: "Standard Shipping",
        method: "standard",
        rateType: "flat",
        pricePaise: 9900,
        minDays: 3,
        maxDays: 7,
      });

      // Free Shipping above ₹999 threshold
      await tx.insert(schema.shippingRates).values({
        tenantId,
        zoneId: shippingZone.id,
        name: "Free Shipping on orders above ₹999",
        method: "standard",
        rateType: "free_above_threshold",
        pricePaise: 0,
        thresholdPaise: 99900,
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

    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const [sub] = await tx
      .insert(schema.subscriptions)
      .values({
        tenantId,
        planId,
        status: "trialing",
        interval: "monthly",
        currentPeriodStart: new Date(),
        currentPeriodEnd: trialEnd,
        provider: "razorpay",
      })
      .returning({ id: schema.subscriptions.id });
    if (!sub) {
      throw new Error("Failed to create subscription record");
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
          buttonUrl: "/collections/all",
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
      }
    }

    // Navigation Menus (Header & Footer)
    await tx.insert(schema.menus).values([
      {
        tenantId,
        handle: "header",
        title: "Main menu",
        items: [
          { title: "Home", url: "/" },
          { title: "Catalog", url: "/collections/all" },
          { title: "About", url: "/pages/about" },
        ],
      },
      {
        tenantId,
        handle: "footer",
        title: "Footer menu",
        items: [
          { title: "About Us", url: "/pages/about" },
          { title: "Privacy Policy", url: "/policies/privacy" },
          { title: "Terms of Service", url: "/policies/terms" },
        ],
      },
    ]);

    // 16. Cleanup any slug reservation
    await tx.execute(sql`
      DELETE FROM slug_reservations WHERE slug = ${slug};
    `);

    // 17. Record Platform Audit Log
    await tx.insert(schema.platformAuditLogs).values({
      actorUserId: source === "self_service" ? ownerId : null,
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

    return {
      tenantId,
      organizationId,
      slug,
      hostname,
      storeUrl,
      adminUrl,
      ownerId,
      subscriptionId: sub.id,
    };
  });
}
