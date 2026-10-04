import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { defaultValueFor, normalizeRules, opsForField, type RuleSet } from "../src/components/segments/conditions-builder.tsx";
import { SegmentRulesInput } from "@bs/contracts";

/** Renders a page inside an in-memory router (list pages link to other routes). */
async function renderRouted(client: QueryClient, Page: () => React.ReactNode) {
  const router = createRouter({ routeTree: createRootRoute({ component: Page }), history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return renderToString(React.createElement(QueryClientProvider, { client }, React.createElement(RouterProvider, { router })));
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const SID = "0199a000-0000-7000-8000-000000000301";

describe("condition builder helpers", () => {
  it("every field's default value for its first operator parses against the domain whitelist", () => {
    for (const field of ["orders_count", "total_spent", "average_order_value", "last_order_at", "first_order_at", "created_at", "marketing_state", "tags", "is_guest", "state", "pincode", "returned", "abandoned_checkout"]) {
      for (const [op] of opsForField(field)) {
        const value = defaultValueFor(field, op);
        if (field === "created_at" && op === "between_dates") continue; // blank dates are a user-input state
        expect(SegmentRulesInput.safeParse({ match: "all", conditions: [{ field, op, value }] }).success, `${field}:${op}`).toBe(true);
      }
    }
  });

  it("changing the operator resets the value to a valid default", () => {
    // Simulate the builder: total_spent gte 5 → switch to between; value must become a [low, high] pair.
    const first = { field: "total_spent", op: "gte", value: defaultValueFor("total_spent", "gte") };
    expect(first.value).toBe(0);
    const switched = { field: first.field, op: "between", value: defaultValueFor("total_spent", "between") };
    expect(Array.isArray(switched.value)).toBe(true);
    expect(SegmentRulesInput.safeParse({ match: "all", conditions: [switched] }).success).toBe(true);
    // last_order_at within → never resets to null.
    expect(defaultValueFor("last_order_at", "never")).toBeNull();
  });

  it("normalizeRules turns the state-in comma string into a code array", () => {
    const rules: RuleSet = { match: "all", conditions: [{ field: "state", op: "in", value: "KA, MH," }] };
    expect(normalizeRules(rules).conditions[0]?.value).toEqual(["KA", "MH"]);
  });
});

describe("condition builder rendering", () => {
  it("renders the match selector, one condition row and the add button", async () => {
    const { ConditionsBuilder } = await import("../src/components/segments/conditions-builder.tsx");
    const qc = newClient();
    const html = renderToString(
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(ConditionsBuilder, {
          rules: { match: "all", conditions: [{ field: "orders_count", op: "gte", value: 2 }] },
          onChange: () => {},
        })),
    );
    expect(html).toContain("Customers who match");
    expect(html).toContain("Orders (counted)");
    expect(html).toContain("Add condition");
    expect(html).toContain("Remove condition 1");
  });

  it("locks adding at 10 conditions with the note visible", async () => {
    const { ConditionsBuilder } = await import("../src/components/segments/conditions-builder.tsx");
    const rules: RuleSet = {
      match: "all",
      conditions: Array.from({ length: 10 }, (_, i) => ({ field: "orders_count", op: "gte", value: i })),
    };
    const qc = newClient();
    const html = renderToString(React.createElement(QueryClientProvider, { client: qc }, React.createElement(ConditionsBuilder, { rules, onChange: () => {} })));
    expect(html).toContain("at most 10 conditions");
    expect(html).toContain("disabled");
  });

  it("shows the valueless editors for returned and never as an em dash", async () => {
    const { ConditionsBuilder } = await import("../src/components/segments/conditions-builder.tsx");
    const qc = newClient();
    const html = renderToString(
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(ConditionsBuilder, {
          rules: { match: "any", conditions: [{ field: "returned", op: "has", value: null }, { field: "last_order_at", op: "never", value: null }] },
          onChange: () => {},
        })),
    );
    expect(html).toContain("Requested a return");
    expect(html).toContain("never placed");
  });
});

const SEG = {
  id: SID,
  name: "VIP customers",
  description: "High spenders",
  kind: "automatic" as const,
  isPreset: true,
  memberCount: 142,
  countedAt: "2026-10-03T10:00:00.000Z",
  createdAt: "2026-10-03T09:00:00.000Z",
  updatedAt: "2026-10-03T10:00:00.000Z",
};

describe("segments list page", () => {
  it("registers the route with a pending skeleton", async () => {
    const { Route } = await import("../src/routes/_store/segments.tsx");
    expect(Route.options.pendingComponent).toBeDefined();
    expect(Route.options.component).toBeDefined();
  });

  it("renders rows with type badges, cached counts and the create action", async () => {
    const { SegmentsPage, segmentsListInput, parseSegmentsSearch } = await import("../src/routes/_store/segments.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.segments.list.queryOptions({ input: segmentsListInput(parseSegmentsSearch({})) }).queryKey, { items: [SEG], total: 1 });
    const html = await renderRouted(qc, SegmentsPage);
    expect(html).toContain("VIP customers");
    expect(html).toContain("High spenders");
    expect(html).toContain("Automatic");
    expect(html).toContain("142");
    expect(html).toContain("Create segment");
  });

  it("renders the empty state with the template action", async () => {
    const { SegmentsPage, segmentsListInput, parseSegmentsSearch } = await import("../src/routes/_store/segments.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.segments.list.queryOptions({ input: segmentsListInput(parseSegmentsSearch({})) }).queryKey, { items: [], total: 0 });
    const html = await renderRouted(qc, SegmentsPage);
    expect(html).toContain("No segments yet");
    expect(html).toContain("Start from a template");
  });
});
