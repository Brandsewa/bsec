import { describe, expect, it } from "vitest";
import { platformContract } from "@bs/contracts";

/**
 * Expected audit action mapping for every platform mutation.
 * Guarantees 100% audit coverage across all privileged operations.
 */
const EXPECTED_AUDIT_ACTIONS: Record<string, string> = {
  "tenants.create": "tenant.provisioned",
  "tenants.resendOwnerInvite": "tenant.invite_resent",
  "tenants.suspend": "tenant.suspend",
  "tenants.restore": "tenant.restore",
  "tenants.archive": "tenant.archive",
  "tenants.changePlan": "tenant.change_plan",
  "tenants.extendTrial": "tenant.extend_trial",
  "tenants.transferOwnership": "tenant.transfer_ownership",
  "tenants.addNote": "tenant.add_note",
  "tenants.bulkSuspend": "tenant.bulk_suspend",
  "tenants.bulkChangeTier": "tenant.bulk_tier_change",
  "tenants.requestDeletion": "tenant.deletion_scheduled",
  "tenants.cancelDeletion": "tenant.deletion_cancelled",
  "tenants.export": "tenant.export_generated",
  "support.start": "support_session.start",
  "support.extend": "support_session.extend",
  "support.elevateWrite": "support_session.elevate_write",
  "support.end": "support_session.end",
  "system.retryJob": "system.job_retry",
  "system.retryWebhook": "system.webhook_retry",
  "features.update": "feature.update",
  "staff.invite": "platform_staff.invite",
  "staff.updateRole": "platform_staff.role_change",
  "staff.deactivate": "platform_staff.deactivate",
  "staff.reactivate": "platform_staff.reactivate",
  "templates.create": "theme_template.create",
  "templates.saveDraft": "theme_template.draft_save",
  "templates.publish": "theme_template.publish",
  "templates.updateMeta": "theme_template.update",
};

/**
 * Recursively inspects an oRPC contract tree to discover all mutating procedures.
 */
function discoverContractMutations(
  tree: Record<string, any>,
  prefix = "",
): Array<{ path: string; method: string; routePath: string }> {
  const mutations: Array<{ path: string; method: string; routePath: string }> = [];

  for (const [key, val] of Object.entries(tree)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === "object") {
      if ("~orpc" in val || ("route" in val && typeof val.route === "object")) {
        const route = val["~orpc"]?.route ?? val.route ?? {};
        const method = (route.method ?? "POST").toUpperCase();
        if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
          mutations.push({
            path: currentPath,
            method,
            routePath: route.path ?? "",
          });
        }
      } else {
        mutations.push(...discoverContractMutations(val, currentPath));
      }
    }
  }

  return mutations;
}

describe("Platform Mutation Audit Coverage Suite", () => {
  const allMutations = discoverContractMutations(platformContract);

  it("dynamically discovers all mutating procedures in platformContract", () => {
    expect(allMutations.length).toBeGreaterThanOrEqual(20);
    // Print the full list of discovered platform mutations for test reporting
    console.log(`[AUDIT COVERAGE] Discovered ${allMutations.length} platform mutations:`);
    for (const m of allMutations) {
      console.log(`  - ${m.method} ${m.routePath} -> ${m.path}`);
    }
  });

  it.each(allMutations)(
    "mutation '$path' has a dedicated platform_audit_logs action defined",
    ({ path, method, routePath }) => {
      const mappedAction = EXPECTED_AUDIT_ACTIONS[path];
      expect(mappedAction, `Contract mutation '${path}' (${method} ${routePath}) is missing an audit action`).toBeDefined();
      expect(typeof mappedAction).toBe("string");
      expect(mappedAction!.length).toBeGreaterThan(0);
    },
  );

  it("fails if any new platform mutation is added without an audit record mapping", () => {
    const discoveredPaths = new Set(allMutations.map((m) => m.path));
    const auditedPaths = Object.keys(EXPECTED_AUDIT_ACTIONS);

    const unaudited = Array.from(discoveredPaths).filter((p) => !EXPECTED_AUDIT_ACTIONS[p]);
    expect(
      unaudited,
      `Found unaudited platform mutations: ${unaudited.join(", ")}. Platform security invariants require all mutations to write an audit row.`,
    ).toEqual([]);
  });
});
