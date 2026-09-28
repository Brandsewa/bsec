/**
 * Every domain service takes ctx first (PLAN §3). The tenant is never taken from the client:
 * it comes from the host (storefront) or session membership + X-Store-Id (admin). Built in M1.
 */
export type Actor =
  | { type: "anonymous" }
  | { type: "customer"; customerId: string }
  | { type: "staff"; userId: string }
  | { type: "platform_support"; userId: string; supportSessionId: string }
  | { type: "system" };

export type StoreStatus = "live" | "coming_soon" | "maintenance" | "password";

export interface TenantContext {
  tenantId: string;
  storeStatus: StoreStatus;
  actor: Actor;
  roles: readonly string[];
  requestId: string;
}
