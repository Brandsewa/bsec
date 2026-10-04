import { eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { getOnboardingProgress } from "../saas/onboarding.ts";
import { getTenantSubscription } from "../saas/billing.ts";
import { listTenantDomains } from "../domains/service.ts";
import { ONLINE_PAYMENT_AVAILABLE } from "./payments-settings.ts";
import { parseStoreConfig } from "./store-config.ts";

/**
 * Read model for the Settings Overview (Settings rebuild Phases 0-1,
 * docs/prompts/settings-rebuild-phase-0-1.md §C). Every fact is verified against the real source of
 * truth; nothing is "configured" merely because a settings row exists.
 */

export interface SettingsOverviewFacts {
  storeStatusMode: "live" | "coming_soon" | "maintenance" | "password";
  storefrontUrl: string | null;
  codEnabled: boolean;
  onlinePaymentAvailable: boolean;
  hasDefaultShippingRate: boolean;
  hasProducts: boolean;
  hasCustomDomain: boolean;
  plan: { name: string; status: string; interval: string } | null;
}

export interface SettingsOverviewActionItem {
  id: string;
  title: string;
  description: string | null;
  href: string | null;
  kind: "required" | "informational";
}

const STORE_MODE_TITLES: Record<SettingsOverviewFacts["storeStatusMode"], string> = {
  coming_soon: "Your storefront is in coming-soon mode. Shoppers cannot buy until you go live.",
  password: "Your storefront is password protected. Only visitors with the password can shop.",
  maintenance: "Your storefront is in maintenance mode. Shoppers see a temporary unavailable page.",
  live: "",
};

/**
 * Derives the Overview action cards from verified facts. Pure function so the shown/omitted matrix is
 * unit-testable without a database (the prompt's test matrix requires a test per readiness condition).
 */
export function deriveSettingsOverviewActions(facts: SettingsOverviewFacts): SettingsOverviewActionItem[] {
  const actions: SettingsOverviewActionItem[] = [];

  if (facts.storeStatusMode !== "live") {
    actions.push({
      id: "store_not_live",
      title: "Store is not live",
      description: STORE_MODE_TITLES[facts.storeStatusMode] || null,
      href: "/settings/storefront",
      kind: "required",
    });
  }

  if (!facts.codEnabled && !facts.onlinePaymentAvailable) {
    actions.push({
      id: "no_payment_method",
      title: "No payment method is available to customers",
      description:
        facts.onlinePaymentAvailable
          ? "Cash on delivery is disabled at checkout."
          : "Cash on delivery is disabled, and online payment is not available on the platform yet.",
      href: "/settings/payments",
      kind: "required",
    });
  }

  if (!facts.hasDefaultShippingRate) {
    actions.push({
      id: "no_shipping_rate",
      title: "No shipping rate for the default zone",
      description: "Customers cannot check out until the default shipping zone has at least one rate.",
      href: "/settings/shipping",
      kind: "required",
    });
  }

  if (!facts.hasProducts) {
    actions.push({
      id: "no_products",
      title: "No products yet",
      description: "Add your first product so the storefront has something to sell.",
      href: "/products/new",
      kind: "required",
    });
  }

  if (!facts.hasCustomDomain) {
    // Informational only: the platform subdomain keeps the store reachable; there is no merchant-facing
    // custom-domain UI yet, so the card explains instead of linking to a page that does not exist.
    actions.push({
      id: "no_custom_domain",
      title: "Using the platform subdomain",
      description:
        "Your store is reachable on its bcom.si subdomain. Connecting a custom domain is handled by platform support for now.",
      href: null,
      kind: "informational",
    });
  }

  return actions;
}

const QUICK_LINKS: ReadonlyArray<{ when: (f: SettingsOverviewFacts) => boolean; href: string; label: string }> = [
  { when: (f) => f.storeStatusMode !== "live", href: "/settings/storefront", label: "Store availability" },
  { when: (f) => !f.codEnabled && !f.onlinePaymentAvailable, href: "/settings/payments", label: "Payment methods" },
  { when: (f) => !f.hasDefaultShippingRate, href: "/settings/shipping", label: "Shipping rates" },
  { when: (f) => !f.hasProducts, href: "/products/new", label: "Add a product" },
  { when: (f) => f.storeStatusMode === "live", href: "/settings/store-details", label: "Store details" },
  { when: () => true, href: "/settings/orders", label: "Order settings" },
];

export async function getSettingsOverview(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "settings.write");

  // Reused server sources. Each opens its own transaction/connection, so they run sequentially
  // before our own withTenant read (never nested inside it).
  const onboarding = await getOnboardingProgress(rt, ctx);
  const [{ subscription, plan: currentPlan }, domainRows] = await Promise.all([
    getTenantSubscription(rt, ctx.tenantId),
    listTenantDomains(rt, ctx.tenantId),
  ]);

  const facts = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [statusRow] = await tx.select({ mode: schema.storeStatus.mode }).from(schema.storeStatus).limit(1);
    const [settingsRow] = await tx
      .select({ checkout: schema.storeSettings.checkout })
      .from(schema.storeSettings)
      .limit(1);
    const cod = parseStoreConfig(settingsRow?.checkout).cod;

    const [zoneRow] = await tx
      .select({ id: schema.shippingZones.id })
      .from(schema.shippingZones)
      .where(eq(schema.shippingZones.isDefault, true))
      .limit(1);
    let hasDefaultShippingRate = false;
    if (zoneRow) {
      const [rateCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.shippingRates)
        .where(eq(schema.shippingRates.zoneId, zoneRow.id));
      hasDefaultShippingRate = (rateCount?.count ?? 0) > 0;
    }

    const [productRow] = await tx.select({ id: schema.products.id }).from(schema.products).limit(1);

    return {
      storeStatusMode: (statusRow?.mode as SettingsOverviewFacts["storeStatusMode"] | undefined) ?? "coming_soon",
      codEnabled: cod.enabled,
      hasDefaultShippingRate,
      hasProducts: Boolean(productRow),
    };
  });

  const activeDomains = domainRows.filter((d) => d.status === "active");
  const primaryDomain = activeDomains.find((d) => d.isPrimary) ?? activeDomains.find((d) => d.type === "platform_subdomain");
  const storefrontHostname = primaryDomain?.hostname ?? null;

  const overviewFacts: SettingsOverviewFacts = {
    ...facts,
    storefrontUrl: storefrontHostname ? `https://${storefrontHostname}` : null,
    onlinePaymentAvailable: ONLINE_PAYMENT_AVAILABLE,
    hasCustomDomain: activeDomains.some((d) => d.type === "custom"),
    plan: currentPlan && subscription ? { name: currentPlan.name, status: subscription.status, interval: subscription.interval } : null,
  };

  const actions = deriveSettingsOverviewActions(overviewFacts);
  const quickLinks = QUICK_LINKS.filter((q) => q.when(overviewFacts))
    .slice(0, 4)
    .map(({ href, label }) => ({ href, label }));

  return {
    storeStatus: { mode: overviewFacts.storeStatusMode, storefrontUrl: overviewFacts.storefrontUrl },
    payments: { codEnabled: overviewFacts.codEnabled, onlinePaymentAvailable: overviewFacts.onlinePaymentAvailable },
    shipping: { hasDefaultRate: overviewFacts.hasDefaultShippingRate },
    products: { hasProducts: overviewFacts.hasProducts },
    domains: { hasCustomDomain: overviewFacts.hasCustomDomain, storefrontHostname },
    plan: overviewFacts.plan,
    onboarding: {
      steps: onboarding.steps,
      completedCount: onboarding.completedCount,
      totalCount: onboarding.totalCount,
      dismissed: onboarding.dismissed,
      allCompleted: onboarding.allCompleted,
    },
    actions,
    quickLinks,
  };
}
