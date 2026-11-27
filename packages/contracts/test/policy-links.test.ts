import { describe, expect, it } from "vitest";
import {
  STORE_POLICY_HANDLES,
  STORE_POLICY_LINK_OPTIONS,
  extractPolicyHandleFromUrl,
  inferPolicyHandleFromLabel,
  isStorePolicyHandle,
  resolvePolicyMenuHref,
} from "../src/policy-links.ts";

describe("policy link helpers", () => {
  it("exposes all five store policy handles and link options", () => {
    expect(STORE_POLICY_HANDLES).toEqual(["privacy", "terms", "refund", "shipping", "legal_notice"]);
    expect(STORE_POLICY_LINK_OPTIONS.map((o) => o.path)).toEqual([
      "/policies/privacy",
      "/policies/terms",
      "/policies/refund",
      "/policies/shipping",
      "/policies/legal_notice",
    ]);
    expect(isStorePolicyHandle("privacy")).toBe(true);
    expect(isStorePolicyHandle("unknown")).toBe(false);
  });

  it("extracts valid policy handles from stored URLs", () => {
    expect(extractPolicyHandleFromUrl("/policies/privacy")).toBe("privacy");
    expect(extractPolicyHandleFromUrl("/Policies/Terms/?v=1#top")).toBe("terms");
    expect(extractPolicyHandleFromUrl("/policies/refund/")).toBe("refund");
    expect(extractPolicyHandleFromUrl("/policies")).toBeUndefined();
    expect(extractPolicyHandleFromUrl("/policies/unknown")).toBeUndefined();
  });

  it("infers policy handles from common merchant footer labels", () => {
    expect(inferPolicyHandleFromLabel("Terms & Conditions")).toBe("terms");
    expect(inferPolicyHandleFromLabel("Terms of Service")).toBe("terms");
    expect(inferPolicyHandleFromLabel("Privacy Policy")).toBe("privacy");
    expect(inferPolicyHandleFromLabel("Refund & Cancellation Policy")).toBe("refund");
    expect(inferPolicyHandleFromLabel("Return Policy")).toBe("refund");
    expect(inferPolicyHandleFromLabel("Shipping Policy")).toBe("shipping");
    expect(inferPolicyHandleFromLabel("Delivery Policy")).toBe("shipping");
    expect(inferPolicyHandleFromLabel("Legal Notice")).toBe("legal_notice");
    expect(inferPolicyHandleFromLabel("Policies")).toBeUndefined();
  });

  it("resolves policy menu hrefs from targetId, specific URL, or legacy /policies + label", () => {
    expect(resolvePolicyMenuHref({ targetId: "shipping", url: "/policies", label: "Anything" })).toBe("/policies/shipping");
    expect(resolvePolicyMenuHref({ url: "/policies/refund", label: "Returns" })).toBe("/policies/refund");
    expect(resolvePolicyMenuHref({ url: "/policies", label: "Terms & Conditions" })).toBe("/policies/terms");
    expect(resolvePolicyMenuHref({ url: "/policies", label: "Privacy Policy" })).toBe("/policies/privacy");
    expect(resolvePolicyMenuHref({ url: "/policies", label: "Refund & Cancellation Policy" })).toBe("/policies/refund");
    expect(resolvePolicyMenuHref({ url: "", label: "Shipping Policy" })).toBe("/policies/shipping");
    expect(resolvePolicyMenuHref({ url: "/policies", label: "Policies" })).toBe("/policies");
  });
});
