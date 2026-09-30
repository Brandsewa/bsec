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
  create: oc
    .route({ method: "POST", path: "/platform/tenants" })
    .input(
      z.object({
        storeName: z.string().min(1),
        slug: z.string().min(3).max(63),
        clientEmail: z.string().email(),
        clientName: z.string().optional(),
        clientPhone: z.string().optional(),
        planCode: z.enum(["starter", "growth", "pro"]).default("growth"),
        themeTemplate: z.string().default("starter-minimal"),
      }),
    )
    .output(
      z.object({
        tenantId: z.string(),
        slug: z.string(),
        hostname: z.string(),
        storeUrl: z.string(),
        adminUrl: z.string(),
        inviteToken: z.string(),
        inviteUrl: z.string(),
      }),
    ),
  resendOwnerInvite: oc
    .route({ method: "POST", path: "/platform/tenants/{id}/resend-invite" })
    .input(z.object({ id: z.string().uuid(), email: z.string().email() }))
    .output(
      z.object({
        inviteId: z.string(),
        tenantId: z.string(),
        email: z.string(),
        inviteToken: z.string(),
        inviteUrl: z.string(),
      }),
    ),
};
