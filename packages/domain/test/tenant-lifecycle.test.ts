import { describe, expect, it } from "vitest";
import {
  TENANT_LIFECYCLE_STATES,
  LIFECYCLE_MATRIX,
  canTransitionTenant,
  assertCanTransitionTenant,
  isStorefrontServed,
  isCheckoutAllowed,
  isAdminAccessAllowed,
  isAdminReadOnly,
  type TenantLifecycleState,
} from "../src/system/tenant-lifecycle.ts";

describe("Tenant Lifecycle State Machine (PLAN §6.4)", () => {
  it("defines all 8 canonical lifecycle states", () => {
    expect(TENANT_LIFECYCLE_STATES).toEqual([
      "provisioning",
      "trial",
      "active",
      "past_due",
      "suspended",
      "archived",
      "deletion_requested",
      "deleted",
    ]);
  });

  describe("Table-driven behavior matrix verification", () => {
    const tableCases: Array<{
      state: TenantLifecycleState;
      storefrontExpected: string;
      checkoutExpected: boolean;
      adminExpected: string;
      domainsJobsExpected: string;
      isStorefrontServedExpected: boolean;
      isCheckoutAllowedExpected: boolean;
      isAdminAccessAllowedExpected: boolean;
      isAdminReadOnlyExpected: boolean;
    }> = [
      {
        state: "provisioning",
        storefrontExpected: "not_served",
        checkoutExpected: false,
        adminExpected: "no",
        domainsJobsExpected: "setup_only",
        isStorefrontServedExpected: false,
        isCheckoutAllowedExpected: false,
        isAdminAccessAllowedExpected: false,
        isAdminReadOnlyExpected: false,
      },
      {
        state: "trial",
        storefrontExpected: "per_store_status",
        checkoutExpected: true,
        adminExpected: "full",
        domainsJobsExpected: "all",
        isStorefrontServedExpected: true,
        isCheckoutAllowedExpected: true,
        isAdminAccessAllowedExpected: true,
        isAdminReadOnlyExpected: false,
      },
      {
        state: "active",
        storefrontExpected: "per_store_status",
        checkoutExpected: true,
        adminExpected: "full",
        domainsJobsExpected: "all",
        isStorefrontServedExpected: true,
        isCheckoutAllowedExpected: true,
        isAdminAccessAllowedExpected: true,
        isAdminReadOnlyExpected: false,
      },
      {
        state: "past_due",
        storefrontExpected: "served",
        checkoutExpected: true,
        adminExpected: "full_with_banner",
        domainsJobsExpected: "all",
        isStorefrontServedExpected: true,
        isCheckoutAllowedExpected: true,
        isAdminAccessAllowedExpected: true,
        isAdminReadOnlyExpected: false,
      },
      {
        state: "suspended",
        storefrontExpected: "temporarily_unavailable",
        checkoutExpected: false,
        adminExpected: "read_only",
        domainsJobsExpected: "marketing_paused",
        isStorefrontServedExpected: false,
        isCheckoutAllowedExpected: false,
        isAdminAccessAllowedExpected: true,
        isAdminReadOnlyExpected: true,
      },
      {
        state: "archived",
        storefrontExpected: "not_found",
        checkoutExpected: false,
        adminExpected: "no",
        domainsJobsExpected: "released",
        isStorefrontServedExpected: false,
        isCheckoutAllowedExpected: false,
        isAdminAccessAllowedExpected: false,
        isAdminReadOnlyExpected: false,
      },
      {
        state: "deletion_requested",
        storefrontExpected: "not_found",
        checkoutExpected: false,
        adminExpected: "no",
        domainsJobsExpected: "deletion_workflow",
        isStorefrontServedExpected: false,
        isCheckoutAllowedExpected: false,
        isAdminAccessAllowedExpected: false,
        isAdminReadOnlyExpected: false,
      },
      {
        state: "deleted",
        storefrontExpected: "not_found",
        checkoutExpected: false,
        adminExpected: "no",
        domainsJobsExpected: "purged",
        isStorefrontServedExpected: false,
        isCheckoutAllowedExpected: false,
        isAdminAccessAllowedExpected: false,
        isAdminReadOnlyExpected: false,
      },
    ];

    it.each(tableCases)(
      "evaluates matrix invariants correctly for state: $state",
      ({
        state,
        storefrontExpected,
        checkoutExpected,
        adminExpected,
        domainsJobsExpected,
        isStorefrontServedExpected,
        isCheckoutAllowedExpected,
        isAdminAccessAllowedExpected,
        isAdminReadOnlyExpected,
      }) => {
        const matrix = LIFECYCLE_MATRIX[state];
        expect(matrix.storefront).toBe(storefrontExpected);
        expect(matrix.checkout).toBe(checkoutExpected);
        expect(matrix.admin).toBe(adminExpected);
        expect(matrix.domainsAndJobs).toBe(domainsJobsExpected);

        expect(isStorefrontServed(state)).toBe(isStorefrontServedExpected);
        expect(isCheckoutAllowed(state)).toBe(isCheckoutAllowedExpected);
        expect(isAdminAccessAllowed(state)).toBe(isAdminAccessAllowedExpected);
        expect(isAdminReadOnly(state)).toBe(isAdminReadOnlyExpected);
      },
    );
  });

  describe("Lifecycle state transitions", () => {
    it("allows self-transitions (idempotent)", () => {
      for (const state of TENANT_LIFECYCLE_STATES) {
        expect(canTransitionTenant(state, state)).toBe(true);
        expect(() => assertCanTransitionTenant(state, state)).not.toThrow();
      }
    });

    it("allows valid forward transitions", () => {
      expect(canTransitionTenant("provisioning", "active")).toBe(true);
      expect(canTransitionTenant("trial", "active")).toBe(true);
      expect(canTransitionTenant("active", "suspended")).toBe(true);
      expect(canTransitionTenant("suspended", "active")).toBe(true);
      expect(canTransitionTenant("active", "past_due")).toBe(true);
      expect(canTransitionTenant("past_due", "active")).toBe(true);
      expect(canTransitionTenant("active", "archived")).toBe(true);
      expect(canTransitionTenant("archived", "active")).toBe(true);
      expect(canTransitionTenant("active", "deletion_requested")).toBe(true);
      expect(canTransitionTenant("deletion_requested", "active")).toBe(true); // cancel grace period
      expect(canTransitionTenant("deletion_requested", "deleted")).toBe(true); // terminal step
    });

    it("rejects illegal transitions", () => {
      // Terminal state cannot transition to anything
      expect(canTransitionTenant("deleted", "active")).toBe(false);
      expect(() => assertCanTransitionTenant("deleted", "active")).toThrow(
        /Invalid tenant lifecycle transition/,
      );

      // Provisioning cannot jump directly to past_due or suspended without becoming trial/active
      expect(canTransitionTenant("provisioning", "past_due")).toBe(false);
      expect(canTransitionTenant("provisioning", "suspended")).toBe(false);

      // Suspended cannot jump directly to trial
      expect(canTransitionTenant("suspended", "trial")).toBe(false);
    });

    it("throws for unknown state values", () => {
      expect(() => assertCanTransitionTenant("active", "bogus_state")).toThrow(
        /Invalid target tenant status/,
      );
    });
  });
});
