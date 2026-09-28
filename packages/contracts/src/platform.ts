import { oc } from "@orpc/contract";
import { z } from "zod";

export const PlatformTenant = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  createdAt: z.string().optional(),
});
export type PlatformTenant = z.infer<typeof PlatformTenant>;

export const platformTenantsContract = {
  list: oc
    .route({ method: "GET", path: "/platform/tenants" })
    .output(z.array(PlatformTenant)),
  get: oc
    .route({ method: "GET", path: "/platform/tenants/{id}" })
    .input(z.object({ id: z.string().uuid() }))
    .output(PlatformTenant),
};
