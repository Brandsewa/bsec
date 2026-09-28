import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * oRPC contracts (PLAN §11). M0 ships only health/version so every surface is wired end to end.
 * Namespaces: storefront.* (tenant from host), admin.* (membership + X-Store-Id),
 * public.* (signup, plans), platform.* (platform container only).
 */
export const Health = z.object({
  status: z.literal("ok"),
  service: z.enum(["web", "platform", "worker"]),
  version: z.string(),
  db: z.object({ ok: z.boolean(), role: z.string() }),
});
export type Health = z.infer<typeof Health>;

const health = oc.route({ method: "GET", path: "/system/health" }).output(Health);

/** Store API, mounted inside Next at /api. */
export const storeContract = {
  system: { health },
};

/** Platform API, served only by apps/platform (BYPASSRLS credentials). */
export const platformContract = {
  system: { health },
};

export type StoreContract = typeof storeContract;
export type PlatformContract = typeof platformContract;
