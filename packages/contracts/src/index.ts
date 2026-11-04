import { oc } from "@orpc/contract";
import type { ContractRouterClient } from "@orpc/contract";
import { z } from "zod";
import { adminContract } from "./admin.ts";
import { platformMarketplaceContract } from "./apps.ts";
import { blogContract } from "./blog.ts";
import {
  platformTenantsContract,
  platformOverviewContract,
  platformDomainsContract,
  platformPlansContract,
  platformLedgerContract,
  platformSignupsContract,
  platformTemplatesContract,
  platformSupportContract,
  platformMarketingContract,
  platformSystemContract,
  platformQuotasContract,
  platformFeaturesContract,
  platformPromotionsContract,
  platformStaffContract,
  platformAuditContract,
  platformEmailContract,
  platformStorageContract,
  platformIntegrationsContract,
  platformSettingsContract,
} from "./platform.ts";
import { storefrontContract } from "./storefront.ts";
import { platformNotificationsContract } from "./notifications.ts";

export * from "./admin.ts";
export * from "./markets.ts";
export * from "./apps.ts";
export * from "./finance.ts";
export * from "./blog.ts";
export * from "./notifications.ts";
export * from "./friendly-ids.ts";
export * from "./platform.ts";
export * from "./plan-content.ts";
export * from "./storefront.ts";

/**
 * oRPC contracts (PLAN §11).
 * Namespaces: storefront.* (tenant from host), admin.* (membership + X-Store-Id),
 * public.* (signup, plans), platform.* (platform container only).
 */
export const Health = z.object({
  status: z.literal("ok"),
  service: z.enum(["web", "platform", "worker"]),
  version: z.string(),
  db: z.object({ ok: z.boolean(), role: z.string() }),
  encryptionKeyConfigured: z.boolean().default(false),
});
export type Health = z.infer<typeof Health>;

const health = oc.route({ method: "GET", path: "/system/health" }).output(Health);

/** Store API, mounted inside Next at /api. */
export const storeContract = {
  system: { health },
  admin: adminContract,
  storefront: storefrontContract,
};

// The website has no theme templates to create.
const sitePagesContract = {
  ...adminContract.pages,
  // The website's header and footer are pages of their own; this creates the missing one from today's layout.
  ensureChrome: oc
    .route({ method: "POST", path: "/marketing/pages/chrome/{key}" })
    .input(z.object({ key: z.enum(["header", "footer"]) }))
    .output(z.object({ id: z.string().uuid(), created: z.boolean() })),
};

/** Platform API, served only by apps/platform (BYPASSRLS credentials). */
export const platformContract = {
  system: {
    health,
    data: platformSystemContract.data,
    retryJob: platformSystemContract.retryJob,
    retryWebhook: platformSystemContract.retryWebhook,
  },
  overview: platformOverviewContract,
  tenants: platformTenantsContract,
  domains: platformDomainsContract,
  plans: platformPlansContract,
  ledger: platformLedgerContract,
  signups: platformSignupsContract,
  templates: platformTemplatesContract,
  support: platformSupportContract,
  marketing: {
    ...platformMarketingContract,
    // The same contracts the store admin uses, so the shared screens in @bs/content-admin work on both (ADR-042).
    blog: blogContract,
    menus: adminContract.menus,
    media: adminContract.media,
    pages: sitePagesContract,
    storefront: adminContract.storefront,
    customerPrivacy: adminContract.customerPrivacy,
  },
  quotas: platformQuotasContract,
  features: platformFeaturesContract,
  promotions: platformPromotionsContract,
  marketplace: platformMarketplaceContract,
  staff: platformStaffContract,
  audit: platformAuditContract,
  email: platformEmailContract,
  notifications: platformNotificationsContract,
  storage: platformStorageContract,
  integrations: platformIntegrationsContract,
  settings: platformSettingsContract,
};

export type StoreContract = typeof storeContract;
export type PlatformContract = typeof platformContract;
export type PlatformClient = ContractRouterClient<PlatformContract>;

export type { ContractRouterClient };
export type StoreClient = ContractRouterClient<StoreContract>;
export * from "./money.ts";
export * from "./units.ts";
