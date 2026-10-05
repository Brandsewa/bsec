import { oc } from "@orpc/contract";
import type { ContractRouterClient } from "@orpc/contract";
import { z } from "zod";
import { adminContract } from "./admin.ts";
import {
  platformTenantsContract,
  platformOverviewContract,
  platformDomainsContract,
  platformPlansContract,
  platformSignupsContract,
  platformTemplatesContract,
  platformSupportContract,
  platformSystemContract,
  platformQuotasContract,
  platformFeaturesContract,
  platformStaffContract,
  platformAuditContract,
  platformEmailContract,
} from "./platform.ts";
import { storefrontContract } from "./storefront.ts";

export * from "./admin.ts";
export * from "./finance.ts";
export * from "./platform.ts";
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
  signups: platformSignupsContract,
  templates: platformTemplatesContract,
  support: platformSupportContract,
  quotas: platformQuotasContract,
  features: platformFeaturesContract,
  staff: platformStaffContract,
  audit: platformAuditContract,
  email: platformEmailContract,
};

export type StoreContract = typeof storeContract;
export type PlatformContract = typeof platformContract;
export type PlatformClient = ContractRouterClient<PlatformContract>;

export type { ContractRouterClient };
export type StoreClient = ContractRouterClient<StoreContract>;
