import { oc } from "@orpc/contract";
import { z } from "zod";

export const Membership = z.object({
  id: z.string(),
  userId: z.string(),
  roleId: z.string(),
  status: z.string(),
  createdAt: z.string().optional(),
});
export type Membership = z.infer<typeof Membership>;

export const StaffInvitation = z.object({
  id: z.string(),
  email: z.string(),
  roleId: z.string(),
  expiresAt: z.string().optional(),
});
export type StaffInvitation = z.infer<typeof StaffInvitation>;

export const StoreSettings = z.object({
  tenantId: z.string(),
  storeName: z.string(),
  currency: z.string(),
  timezone: z.string(),
});
export type StoreSettings = z.infer<typeof StoreSettings>;

export const FeatureFlagItem = z.object({
  key: z.string(),
  enabled: z.boolean(),
});
export type FeatureFlagItem = z.infer<typeof FeatureFlagItem>;

export const adminContract = {
  memberships: {
    list: oc
      .route({ method: "GET", path: "/admin/memberships" })
      .output(z.array(Membership)),
    invite: oc
      .route({ method: "POST", path: "/admin/memberships/invite" })
      .input(
        z.object({
          email: z.string().email(),
          roleId: z.string().uuid(),
        }),
      )
      .output(StaffInvitation),
  },
  settings: {
    get: oc
      .route({ method: "GET", path: "/admin/settings" })
      .output(StoreSettings),
    update: oc
      .route({ method: "PATCH", path: "/admin/settings" })
      .input(
        z.object({
          storeName: z.string().min(1).optional(),
          currency: z.string().min(3).max(3).optional(),
          timezone: z.string().optional(),
        }),
      )
      .output(StoreSettings),
  },
  featureFlags: {
    list: oc
      .route({ method: "GET", path: "/admin/feature-flags" })
      .output(z.array(FeatureFlagItem)),
  },
};
