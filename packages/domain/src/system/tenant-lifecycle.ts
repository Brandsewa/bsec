/**
 * Tenant Lifecycle State Machine & Invariants (PLAN §6.4).
 * Single shared source of truth for tenant states and behavior across:
 * - Storefront access
 * - Store checkout
 * - Store admin (full vs read-only vs blocked)
 * - Custom domains & background jobs
 * - Billing & data retention
 */

export const TENANT_LIFECYCLE_STATES = [
  "provisioning",
  "trial",
  "active",
  "past_due",
  "suspended",
  "archived",
  "deletion_requested",
  "deleted",
] as const;

export type TenantLifecycleState = (typeof TENANT_LIFECYCLE_STATES)[number];

export interface LifecycleBehavior {
  storefront: "not_served" | "per_store_status" | "served" | "temporarily_unavailable" | "not_found";
  checkout: boolean;
  admin: "no" | "full" | "full_with_banner" | "read_only";
  domainsAndJobs: "setup_only" | "all" | "marketing_paused" | "released" | "deletion_workflow" | "purged";
  billingAndData: string;
}

export const LIFECYCLE_MATRIX: Record<TenantLifecycleState, LifecycleBehavior> = {
  provisioning: {
    storefront: "not_served",
    checkout: false,
    admin: "no",
    domainsAndJobs: "setup_only",
    billingAndData: "setup",
  },
  trial: {
    storefront: "per_store_status",
    checkout: true,
    admin: "full",
    domainsAndJobs: "all",
    billingAndData: "trial_clock",
  },
  active: {
    storefront: "per_store_status",
    checkout: true,
    admin: "full",
    domainsAndJobs: "all",
    billingAndData: "billed",
  },
  past_due: {
    storefront: "served",
    checkout: true,
    admin: "full_with_banner",
    domainsAndJobs: "all",
    billingAndData: "dunning_grace_period",
  },
  suspended: {
    storefront: "temporarily_unavailable",
    checkout: false,
    admin: "read_only",
    domainsAndJobs: "marketing_paused",
    billingAndData: "kept",
  },
  archived: {
    storefront: "not_found",
    checkout: false,
    admin: "no",
    domainsAndJobs: "released",
    billingAndData: "kept_90_days",
  },
  deletion_requested: {
    storefront: "not_found",
    checkout: false,
    admin: "no",
    domainsAndJobs: "deletion_workflow",
    billingAndData: "deletion_pipeline",
  },
  deleted: {
    storefront: "not_found",
    checkout: false,
    admin: "no",
    domainsAndJobs: "purged",
    billingAndData: "invoices_retained_8_years",
  },
};

export const ALLOWED_TRANSITIONS: Record<TenantLifecycleState, readonly TenantLifecycleState[]> = {
  provisioning: ["trial", "active", "deletion_requested"],
  trial: ["active", "past_due", "suspended", "archived", "deletion_requested"],
  active: ["past_due", "suspended", "archived", "deletion_requested"],
  past_due: ["active", "suspended", "archived", "deletion_requested"],
  suspended: ["active", "archived", "deletion_requested"],
  archived: ["active", "deletion_requested"],
  // Cancelling a deletion puts the store back into whatever state it was in before the request.
  deletion_requested: ["trial", "active", "past_due", "suspended", "archived", "deleted"],
  deleted: [], // terminal state
};

export function canTransitionTenant(from: TenantLifecycleState, to: TenantLifecycleState): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertCanTransitionTenant(from: string, to: string): asserts to is TenantLifecycleState {
  const fromState = from as TenantLifecycleState;
  const toState = to as TenantLifecycleState;
  if (!TENANT_LIFECYCLE_STATES.includes(toState)) {
    throw new Error(`Invalid target tenant status: '${to}'`);
  }
  if (!canTransitionTenant(fromState, toState)) {
    throw new Error(`Invalid tenant lifecycle transition: cannot move from '${from}' to '${to}'`);
  }
}

export function isStorefrontServed(status: string): boolean {
  const behavior = LIFECYCLE_MATRIX[status as TenantLifecycleState];
  return behavior?.storefront === "per_store_status" || behavior?.storefront === "served";
}

export function isCheckoutAllowed(status: string): boolean {
  const behavior = LIFECYCLE_MATRIX[status as TenantLifecycleState];
  return Boolean(behavior?.checkout);
}

export function isAdminAccessAllowed(status: string): boolean {
  const behavior = LIFECYCLE_MATRIX[status as TenantLifecycleState];
  return behavior?.admin !== "no" && behavior !== undefined;
}

export function isAdminReadOnly(status: string): boolean {
  const behavior = LIFECYCLE_MATRIX[status as TenantLifecycleState];
  return behavior?.admin === "read_only";
}

export type StorefrontLifecycleDecision =
  | { served: true }
  | { served: false; httpStatus: 404 | 503; reason: "provisioning" | "suspended" | "not_found" };

/**
 * What the public storefront does for a store in a given lifecycle state (PLAN §6.4). The single decision used by the
 * storefront request pipeline, so the matrix above is not just documentation.
 */
export function storefrontLifecycleDecision(status: string): StorefrontLifecycleDecision {
  const behavior = LIFECYCLE_MATRIX[status as TenantLifecycleState];
  switch (behavior?.storefront) {
    case "per_store_status":
    case "served":
      return { served: true };
    case "not_served":
      return { served: false, httpStatus: 503, reason: "provisioning" };
    case "temporarily_unavailable":
      return { served: false, httpStatus: 503, reason: "suspended" };
    default:
      return { served: false, httpStatus: 404, reason: "not_found" };
  }
}

/** Marketing jobs (abandoned-cart e-mails and the like) run only for stores that are live. */
export function isMarketingAllowed(status: string): boolean {
  const behavior = LIFECYCLE_MATRIX[status as TenantLifecycleState];
  return behavior?.domainsAndJobs === "all";
}

/** Adding, verifying or changing custom domains is only possible while the store is fully live. */
export function isDomainManagementAllowed(status: string): boolean {
  const behavior = LIFECYCLE_MATRIX[status as TenantLifecycleState];
  return behavior?.domainsAndJobs === "all";
}
