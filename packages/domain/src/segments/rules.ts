import { z } from "zod";

/**
 * The segment rule language (Customers Segments PLAN §3): a flat list of conditions,
 * matched with all (AND) or any (OR), maximum 10. This whitelist is the whole language —
 * anything else is rejected here before the compiler ever sees it. Values are plain JSON
 * values bound as SQL parameters by the compiler; no SQL or column names ever come from
 * the client.
 */

export type SegmentMatch = "all" | "any";

export interface SegmentRuleCondition {
  field: string;
  op: string;
  value: unknown;
}

export interface SegmentRules {
  match: SegmentMatch;
  conditions: SegmentRuleCondition[];
}

/** Error for anything wrong with a rule set; safe to show to staff. */
export class SegmentRuleError extends Error {}

const int = z.number().int();
const betweenTuple = <T extends z.ZodTypeAny>(element: T) =>
  z.tuple([element, element]).refine(([lo, hi]) => lo <= hi, "low must be at most high");
const positiveDays = z.number().int().min(1).max(3650);
const dateText = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be a date (YYYY-MM-DD or ISO)");
const stateCodeText = z.string().min(2).max(3);
const nonEmptyText = z.string().min(1).max(500);
const uuidText = z.string().uuid();

interface FieldSpec {
  ops: readonly string[];
  value: z.ZodTypeAny;
  /** Human-readable value shape for error messages. */
  valueLabel: string;
}

/**
 * Field → allowed operators and value shape (PLAN §3 table). Metric fields read the
 * Phase 0 truthful metrics; `state` and `pincode` read the customer's default address.
 */
export const SEGMENT_FIELD_SPECS: Record<string, FieldSpec> = {
  orders_count: { ops: ["eq", "gte", "lte"], value: int, valueLabel: "an integer" },
  total_spent: { ops: ["gte", "lte", "between"], value: z.union([int, betweenTuple(int)]), valueLabel: "an integer (paise) or [low, high]" },
  average_order_value: { ops: ["gte", "lte"], value: int, valueLabel: "an integer (paise)" },
  last_order_at: { ops: ["within_days", "older_than_days", "never"], value: z.union([positiveDays, z.null()]), valueLabel: "a number of days, or null for never" },
  first_order_at: { ops: ["within_days", "older_than_days"], value: positiveDays, valueLabel: "a number of days" },
  created_at: { ops: ["within_days", "older_than_days", "between_dates"], value: z.union([positiveDays, betweenTuple(dateText)]), valueLabel: "a number of days or [from, to] dates" },
  marketing_state: { ops: ["is", "is_not"], value: z.enum(["subscribed", "unsubscribed", "not_subscribed"]), valueLabel: "subscribed, unsubscribed or not_subscribed" },
  tags: { ops: ["has", "has_not"], value: nonEmptyText, valueLabel: "a tag" },
  is_guest: { ops: ["is"], value: z.boolean(), valueLabel: "true or false" },
  state: { ops: ["is", "is_not", "in"], value: z.union([stateCodeText, z.array(stateCodeText).min(1)]), valueLabel: "a state code or a list of state codes" },
  pincode: { ops: ["starts_with", "is"], value: nonEmptyText, valueLabel: "a pincode or its first digits" },
  bought_product: { ops: ["has", "has_not"], value: uuidText, valueLabel: "a product id" },
  bought_collection: { ops: ["has", "has_not"], value: uuidText, valueLabel: "a collection id" },
  returned: { ops: ["has", "has_not"], value: z.null(), valueLabel: "null" },
  abandoned_checkout: { ops: ["within_days"], value: positiveDays, valueLabel: "a number of days" },
  in_segment: { ops: ["is", "is_not"], value: uuidText, valueLabel: "a segment id" },
};

export const SEGMENT_RULE_FIELDS = Object.keys(SEGMENT_FIELD_SPECS);

const conditionSchema = z
  .object({ field: z.string(), op: z.string(), value: z.unknown().optional() })
  .superRefine((c, ctx) => {
    const spec = SEGMENT_FIELD_SPECS[c.field];
    if (!spec) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["field"], message: `Unknown field "${c.field}"` });
      return;
    }
    if (!spec.ops.includes(c.op)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["op"], message: `Field "${c.field}" does not allow operator "${c.op}" (allowed: ${spec.ops.join(", ")})` });
      return;
    }
    const parsed = spec.value.safeParse(c.value);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? "invalid value";
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `Field "${c.field}" with "${c.op}" needs ${spec.valueLabel} (${first})` });
    }
  });

export const segmentRulesSchema = z.object({
  match: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).min(1, "A segment needs at least one condition").max(10, "A segment can have at most 10 conditions"),
});

/** Validates a rule set from the client; throws SegmentRuleError with a staff-readable message. */
export function parseSegmentRules(input: unknown): SegmentRules {
  const result = segmentRulesSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    throw new SegmentRuleError(`Invalid segment rules${path}: ${issue?.message ?? "unknown error"}`);
  }
  return result.data as SegmentRules;
}

/** True when the rule set contains any `in_segment` condition. */
export function rulesReferenceSegments(rules: SegmentRules): boolean {
  return rules.conditions.some((c) => c.field === "in_segment");
}
