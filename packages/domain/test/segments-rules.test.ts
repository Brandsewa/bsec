import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { parseSegmentRules, rulesReferenceSegments, segmentRulesSchema, SEGMENT_RULE_FIELDS } from "../src/segments/rules.ts";
import { segmentMemberSubquery } from "../src/segments/compile.ts";
import type { SegmentRules } from "../src/segments/rules.ts";

const dialect = new PgDialect();
const TENANT = "0199a000-0000-7000-8000-00000000a001";
const SEGMENT_ID = "0199a000-0000-7000-8000-00000000b001";
const resolveOk = () => ({ kind: "manual" as const, rules: null });

/** One accepted example per field, so the whole whitelist stays wired (PLAN §3 table). */
const ACCEPTED: Array<[string, string, unknown]> = [
  ["orders_count", "gte", 2],
  ["orders_count", "eq", 0],
  ["total_spent", "gte", 500000],
  ["total_spent", "between", [100000, 500000]],
  ["average_order_value", "lte", 200000],
  ["last_order_at", "within_days", 30],
  ["last_order_at", "older_than_days", 90],
  ["last_order_at", "never", null],
  ["first_order_at", "older_than_days", 365],
  ["created_at", "within_days", 7],
  ["created_at", "between_dates", ["2026-01-01", "2026-02-01"]],
  ["marketing_state", "is", "subscribed"],
  ["marketing_state", "is_not", "not_subscribed"],
  ["tags", "has", "VIP"],
  ["tags", "has_not", "wholesale"],
  ["is_guest", "is", true],
  ["state", "is", "KA"],
  ["state", "in", ["KA", "MH"]],
  ["pincode", "starts_with", "560"],
  ["bought_product", "has", "0199a000-0000-7000-8000-00000000c001"],
  ["bought_collection", "has_not", "0199a000-0000-7000-8000-00000000c002"],
  ["returned", "has", null],
  ["abandoned_checkout", "within_days", 14],
  ["in_segment", "is", SEGMENT_ID],
];

describe("segment rule schema (PLAN §3 whitelist)", () => {
  it("accepts an example of every field and operator", () => {
    for (const [field, op, value] of ACCEPTED) {
      const parsed = segmentRulesSchema.safeParse({ match: "all", conditions: [{ field, op, value }] });
      expect(parsed.success, `${field} ${op} should parse`).toBe(true);
    }
  });

  it("exposes the exact field whitelist", () => {
    expect(SEGMENT_RULE_FIELDS).toEqual([
      "orders_count",
      "total_spent",
      "average_order_value",
      "last_order_at",
      "first_order_at",
      "created_at",
      "marketing_state",
      "tags",
      "is_guest",
      "state",
      "pincode",
      "bought_product",
      "bought_collection",
      "returned",
      "abandoned_checkout",
      "in_segment",
    ]);
  });

  it("rejects an unknown field with a readable message", () => {
    expect(() => parseSegmentRules({ match: "all", conditions: [{ field: "loyalty_points", op: "gte", value: 1 }] })).toThrow(/Unknown field "loyalty_points"/);
  });

  it("rejects an operator the field does not allow", () => {
    expect(() => parseSegmentRules({ match: "all", conditions: [{ field: "total_spent", op: "within_days", value: 5 }] })).toThrow(/does not allow operator/);
  });

  it("rejects wrong value shapes", () => {
    expect(() => parseSegmentRules({ match: "all", conditions: [{ field: "is_guest", op: "is", value: "yes" }] })).toThrow(/needs true or false/);
    expect(() => parseSegmentRules({ match: "all", conditions: [{ field: "marketing_state", op: "is", value: "invalid" }] })).toThrow(/needs subscribed/);
    expect(() => parseSegmentRules({ match: "all", conditions: [{ field: "total_spent", op: "between", value: [5, 1] }] })).toThrow(/low must be/);
    expect(() => parseSegmentRules({ match: "all", conditions: [{ field: "returned", op: "has", value: "x" }] })).toThrow(/needs null/);
  });

  it("rejects more than 10 conditions and empty condition lists", () => {
    const conditions = Array.from({ length: 11 }, (_, i) => ({ field: "orders_count", op: "gte", value: i }));
    expect(() => parseSegmentRules({ match: "all", conditions })).toThrow(/at most 10/);
    expect(() => parseSegmentRules({ match: "all", conditions: [] })).toThrow(/at least one/);
    expect(() => parseSegmentRules({ match: "all", conditions: conditions.slice(0, 10) })).not.toThrow();
  });

  it("rejects a bad match mode and non-object rule sets", () => {
    expect(() => parseSegmentRules({ match: "some", conditions: [{ field: "orders_count", op: "gte", value: 1 }] })).toThrow();
    expect(() => parseSegmentRules("DROP TABLE customers")).toThrow();
  });

  it("reports whether a rule set references other segments", () => {
    const rules: SegmentRules = parseSegmentRules({ match: "any", conditions: [{ field: "in_segment", op: "is", value: SEGMENT_ID }, { field: "orders_count", op: "gte", value: 1 }] });
    expect(rulesReferenceSegments(rules)).toBe(true);
    expect(rulesReferenceSegments(parseSegmentRules({ match: "all", conditions: [{ field: "orders_count", op: "gte", value: 1 }] }))).toBe(false);
  });
});

describe("segment rule compiler (PLAN §3: the only place SQL is built from rules)", () => {
  it("binds every value as a parameter: hostile SQL in a value never reaches the query text", () => {
    const hostile = "'; DROP TABLE customers; --";
    const rules = parseSegmentRules({ match: "any", conditions: [{ field: "tags", op: "has", value: hostile }, { field: "marketing_state", op: "is", value: "subscribed" }] });
    const q = dialect.sqlToQuery(segmentMemberSubquery(TENANT, rules, resolveOk));
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.sql).not.toContain(hostile);
    expect(q.params).toContain(hostile);
    expect(q.params).toContain("subscribed");
  });

  it("compiles match all with AND and match any with OR, over the metrics lateral", () => {
    const all = parseSegmentRules({
      match: "all",
      conditions: [
        { field: "orders_count", op: "gte", value: 2 },
        { field: "total_spent", op: "gte", value: 100000 },
      ],
    });
    const allQ = dialect.sqlToQuery(segmentMemberSubquery(TENANT, all, resolveOk));
    expect(allQ.sql).toContain(" AND ");
    expect(allQ.sql).toContain("metrics.orders_count");
    expect(allQ.sql).toContain("metrics.total_spent");
    // The metrics lateral and the conditions all bind as parameters.
    expect(allQ.params).toContain(2);
    expect(allQ.params).toContain(100000);
    expect(allQ.params).toContain(TENANT);

    const any = parseSegmentRules({
      match: "any",
      conditions: [
        { field: "is_guest", op: "is", value: true },
        { field: "marketing_state", op: "is", value: "subscribed" },
      ],
    });
    const anyQ = dialect.sqlToQuery(segmentMemberSubquery(TENANT, any, resolveOk));
    expect(anyQ.sql).toContain(" OR ");
  });

  it("expands a manual in_segment reference to the membership table", () => {
    const rules = parseSegmentRules({ match: "all", conditions: [{ field: "in_segment", op: "is", value: SEGMENT_ID }] });
    const q = dialect.sqlToQuery(segmentMemberSubquery(TENANT, rules, resolveOk));
    expect(q.sql).toContain("customer_segment_members");
    expect(q.params).toContain(SEGMENT_ID);
  });

  it("refuses a self-reference and an unknown referenced segment", () => {
    const self = parseSegmentRules({ match: "all", conditions: [{ field: "in_segment", op: "is", value: SEGMENT_ID }] });
    expect(() => segmentMemberSubquery(TENANT, self, resolveOk, { selfSegmentId: SEGMENT_ID })).toThrow(/cannot include itself/);
    expect(() => segmentMemberSubquery(TENANT, self, () => { throw new Error("not found"); })).toThrow(/not found/);
  });

  it("enforces depth 1: a referenced automatic segment may not use in_segment itself", () => {
    const inner = parseSegmentRules({ match: "all", conditions: [{ field: "in_segment", op: "is", value: SEGMENT_ID }] });
    const resolveAuto = () => ({ kind: "automatic" as const, rules: inner });
    const outer = parseSegmentRules({ match: "all", conditions: [{ field: "in_segment", op: "is_not", value: "0199a000-0000-7000-8000-00000000b002" }] });
    expect(() => segmentMemberSubquery(TENANT, outer, resolveAuto)).toThrow(/one level only/);

    // An automatic segment without in_segment inside is fine.
    const innerPlain = parseSegmentRules({ match: "all", conditions: [{ field: "orders_count", op: "gte", value: 1 }] });
    const resolveAutoPlain = () => ({ kind: "automatic" as const, rules: innerPlain });
    expect(() => segmentMemberSubquery(TENANT, outer, resolveAutoPlain)).not.toThrow();
  });
});
