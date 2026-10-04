import { describe, expect, it } from "vitest";
import {
  ListSettingsActivityInput,
  ListSettingsActivityOutput,
} from "@bs/contracts";
import { mapActionToArea, sanitizeDiff } from "../src/admin/settings-activity.ts";

describe("SettingsActivity Contract & Sanitization", () => {
  it("parses valid ListSettingsActivityInput with defaults", () => {
    const parsed = ListSettingsActivityInput.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);

    const withFilters = ListSettingsActivityInput.parse({
      area: "Orders",
      actorId: "0199a000-0000-7000-8000-000000000001",
      dateFrom: "2026-10-01T00:00:00Z",
      dateTo: "2026-10-04T00:00:00Z",
      limit: 20,
      offset: 10,
    });
    expect(withFilters.area).toBe("Orders");
    expect(withFilters.limit).toBe(20);
    expect(withFilters.offset).toBe(10);
  });

  it("validates ListSettingsActivityOutput structure", () => {
    const valid = ListSettingsActivityOutput.parse({
      items: [
        {
          id: "0199a000-0000-7000-8000-000000000001",
          action: "store_settings.update",
          area: "Store details",
          actorType: "staff",
          actorId: "0199a000-0000-7000-8000-000000000099",
          actorEmail: "staff@example.com",
          targetType: "store_settings",
          targetId: "0199a000-0000-7000-8000-000000000001",
          diff: {
            storeName: { before: "Old", after: "New" },
          },
          createdAt: "2026-10-04T12:00:00.000Z",
        },
      ],
      total: 1,
    });
    expect(valid.total).toBe(1);
    expect(valid.items[0]?.area).toBe("Store details");
  });

  it("sanitizes secret-shaped values defensively", () => {
    const rawDiff = {
      storeName: { before: "Old", after: "New" },
      apiKey: { before: "key_secret_123", after: "key_secret_456" },
      secretToken: "xyz",
      nested: {
        normalField: "hello",
        webhookSecret: "secret-abc",
      },
    };

    const clean = sanitizeDiff(rawDiff);
    expect(clean).not.toBeNull();
    expect(clean!.storeName).toEqual({ before: "Old", after: "New" });
    expect(clean!.apiKey).toEqual({ before: "[REDACTED]", after: "[REDACTED]" });
    expect(clean!.secretToken).toEqual({ before: "[REDACTED]", after: "[REDACTED]" });
    expect(clean!.nested).toEqual({
      before: null,
      after: {
        normalField: "hello",
        webhookSecret: "[REDACTED]",
      },
    });
  });

  it("maps mutation actions to human-readable settings areas", () => {
    expect(mapActionToArea("store_settings.update")).toBe("Store details");
    expect(mapActionToArea("order_settings.update")).toBe("Orders");
    expect(mapActionToArea("return_settings.update")).toBe("Returns");
    expect(mapActionToArea("shipping_rates.update")).toBe("Shipping");
    expect(mapActionToArea("brand_settings.update")).toBe("Branding");
    expect(mapActionToArea("custom_domain.add")).toBe("Domains");
    expect(mapActionToArea("staff_membership.role_change")).toBe("Users");
    expect(mapActionToArea("support_consent.update")).toBe("Support access");
    expect(mapActionToArea("unknown_action")).toBe("General");
  });
});
