import { sql, type SQL } from "drizzle-orm";
import { schema } from "@bs/db";
import { customerMetricsSql } from "../customers/metrics.ts";
import { SegmentRuleError, type SegmentRuleCondition, type SegmentRules } from "./rules.ts";

/**
 * The segment rule compiler (Customers Segments PLAN §3) — the ONLY place SQL is built
 * from segment rules. The client sends field/op/value JSON validated by rules.ts; values
 * become bound parameters here and column names come from the whitelist, never from input.
 *
 * Output shape: a WHERE predicate over the unaliased `customers` table, which must appear
 * in a query that also joins the Phase 0 metrics lateral (`customerMetricsSql(tenantId)`)
 * for the metric fields. `segmentMemberSubquery` returns a self-contained
 * `(SELECT customers.id …)` used for previews, `in_segment` expansion and count refresh.
 */

/** Resolves an `in_segment` reference to the referenced segment (must exist in this store). */
export type SegmentRefResolver = (segmentId: string) => { kind: "manual" | "automatic"; rules: SegmentRules | null };

export interface CompileOptions {
  /** The segment being compiled, so a self-reference is refused immediately. */
  selfSegmentId?: string | undefined;
  /**
   * Depth guard (PLAN §3): `in_segment` may point at another segment, but a referenced
   * AUTOMATIC segment may not itself use `in_segment` — depth 1 only.
   */
  allowInSegment?: boolean | undefined;
}

/** A self-contained `(SELECT customers.id FROM customers …)` matching the rule set. */
export function segmentMemberSubquery(tenantId: string, rules: SegmentRules, resolve: SegmentRefResolver, opts: CompileOptions = {}): SQL {
  const predicate = rulePredicate(tenantId, rules, resolve, { ...opts, allowInSegment: opts.allowInSegment ?? true });
  return sql`(
    SELECT customers.id
    FROM ${schema.customers}
    LEFT JOIN ${customerMetricsSql(tenantId)} ON true
    WHERE ${predicate}
  )`;
}

function rulePredicate(
  tenantId: string,
  rules: SegmentRules,
  resolve: SegmentRefResolver,
  opts: Required<Pick<CompileOptions, "allowInSegment">> & CompileOptions,
): SQL {
  const parts = rules.conditions.map((c) => conditionSql(tenantId, c, resolve, opts));
  const first = parts[0];
  if (parts.length === 1 && first) return first;
  const joined = sql.join(parts, rules.match === "all" ? sql` AND ` : sql` OR `);
  return rules.match === "all" ? joined : sql`(${joined})`;
}

/** The default shipping address: the row flagged default, else the newest address. */
const defaultAddressExists = (tenantId: string, extra: SQL) => sql`
  EXISTS (
    SELECT 1 FROM ${schema.customerAddresses} a
    WHERE a.tenant_id = ${tenantId}
      AND a.customer_id = ${schema.customers.id}
      AND a.is_default
      AND ${extra}
  )`;

/** A non-cancelled order of this customer (matched by id, or by email for guests). */
const customerOrderExists = (tenantId: string, extra: SQL) => sql`
  EXISTS (
    SELECT 1 FROM ${schema.orders} o
    WHERE o.tenant_id = ${tenantId}
      AND o.status <> 'cancelled'
      AND (o.customer_id = ${schema.customers.id} OR (o.customer_id IS NULL AND o.email = ${schema.customers.email}))
      AND ${extra}
  )`;

function conditionSql(
  tenantId: string,
  c: SegmentRuleCondition,
  resolve: SegmentRefResolver,
  opts: Required<Pick<CompileOptions, "allowInSegment">> & CompileOptions,
): SQL {
  const v = c.value;
  switch (c.field) {
    // Orders and spend — the Phase 0 truthful metrics, never the cached columns.
    case "orders_count":
      return sql`metrics.orders_count = ${v}`;
    case "total_spent":
      return Array.isArray(v)
        ? sql`metrics.total_spent BETWEEN ${v[0]} AND ${v[1]}`
        : c.op === "gte"
          ? sql`metrics.total_spent >= ${v}`
          : sql`metrics.total_spent <= ${v}`;
    case "average_order_value":
      return c.op === "gte" ? sql`metrics.average_order_value >= ${v}` : sql`metrics.average_order_value <= ${v}`;
    case "last_order_at":
      return c.op === "never"
        ? sql`metrics.last_order_at IS NULL`
        : c.op === "within_days"
          ? sql`metrics.last_order_at IS NOT NULL AND metrics.last_order_at >= now() - make_interval(days => ${v})`
          : sql`metrics.last_order_at < now() - make_interval(days => ${v})`;
    case "first_order_at":
      return c.op === "within_days"
        ? sql`metrics.first_order_at IS NOT NULL AND metrics.first_order_at >= now() - make_interval(days => ${v})`
        : sql`metrics.first_order_at < now() - make_interval(days => ${v})`;
    case "created_at":
      return Array.isArray(v)
        ? sql`${schema.customers.createdAt} >= ${v[0]} AND ${schema.customers.createdAt} < ${v[1]}`
        : c.op === "within_days"
          ? sql`${schema.customers.createdAt} >= now() - make_interval(days => ${v})`
          : sql`${schema.customers.createdAt} < now() - make_interval(days => ${v})`;

    // Profile and consent.
    case "marketing_state":
      return c.op === "is" ? sql`${schema.customers.marketingState} = ${v}` : sql`${schema.customers.marketingState} <> ${v}`;
    case "tags":
      return c.op === "has" ? sql`${v} = ANY(${schema.customers.tags})` : sql`NOT (${v} = ANY(${schema.customers.tags}))`;
    case "is_guest":
      return sql`${schema.customers.isGuest} = ${v}`;

    // Location — the default address.
    case "state": {
      if (c.op === "in") {
        const list = (v as string[]).map((code) => sql`${code}`);
        return defaultAddressExists(tenantId, sql`a.state_code IN (${sql.join(list, sql`, `)})`);
      }
      return c.op === "is"
        ? defaultAddressExists(tenantId, sql`a.state_code = ${v}`)
        : sql`NOT ${defaultAddressExists(tenantId, sql`a.state_code = ${v}`)}`;
    }
    case "pincode":
      return c.op === "starts_with"
        ? defaultAddressExists(tenantId, sql`a.pincode LIKE ${`${v}%`}`)
        : defaultAddressExists(tenantId, sql`a.pincode = ${v}`);

    // Purchases and checkouts.
    case "bought_product": {
      const exists = customerOrderExists(
        tenantId,
        sql`EXISTS (SELECT 1 FROM ${schema.orderItems} oi JOIN ${schema.variants} var ON var.tenant_id = ${tenantId} AND var.id = oi.variant_id WHERE oi.tenant_id = ${tenantId} AND oi.order_id = o.id AND var.product_id = ${v})`,
      );
      return c.op === "has" ? exists : sql`NOT ${exists}`;
    }
    case "bought_collection": {
      const exists = customerOrderExists(
        tenantId,
        sql`EXISTS (
          SELECT 1 FROM ${schema.orderItems} oi
          JOIN ${schema.variants} var ON var.tenant_id = ${tenantId} AND var.id = oi.variant_id
          JOIN ${schema.collectionProducts} cp ON cp.tenant_id = ${tenantId} AND cp.product_id = var.product_id
          WHERE oi.tenant_id = ${tenantId} AND oi.order_id = o.id AND cp.collection_id = ${v}
        )`,
      );
      return c.op === "has" ? exists : sql`NOT ${exists}`;
    }
    case "abandoned_checkout":
      return sql`EXISTS (
        SELECT 1 FROM ${schema.carts} c
        WHERE c.tenant_id = ${tenantId} AND c.customer_id = ${schema.customers.id}
          AND c.status = 'abandoned' AND c.created_at >= now() - make_interval(days => ${v})
      )`;

    // Returns (same matching as the metrics fragment).
    case "returned": {
      const exists = sql`EXISTS (
        SELECT 1 FROM ${schema.returns} ret
        WHERE ret.tenant_id = ${tenantId} AND ret.status <> 'cancelled'
          AND (ret.customer_id = ${schema.customers.id} OR ret.order_id IN (
            SELECT o2.id FROM ${schema.orders} o2
            WHERE o2.tenant_id = ${tenantId}
              AND (o2.customer_id = ${schema.customers.id} OR (o2.customer_id IS NULL AND o2.email = ${schema.customers.email}))
          ))
      )`;
      return c.op === "has" ? exists : sql`NOT ${exists}`;
    }

    // Other segments.
    case "in_segment": {
      if (!opts.allowInSegment) {
        throw new SegmentRuleError("Referenced segments cannot themselves use an in_segment condition (one level only)");
      }
      if (opts.selfSegmentId && v === opts.selfSegmentId) {
        throw new SegmentRuleError("A segment cannot include itself");
      }
      const ref = resolve(v as string);
      if (ref.kind === "manual") {
        const members = sql`(SELECT m.customer_id FROM ${schema.customerSegmentMembers} m WHERE m.tenant_id = ${tenantId} AND m.segment_id = ${v})`;
        return c.op === "is" ? sql`${schema.customers.id} IN ${members}` : sql`${schema.customers.id} NOT IN ${members}`;
      }
      if (!ref.rules) throw new SegmentRuleError(`Referenced segment "${ref.kind}" has no rules`);
      const members = segmentMemberSubquery(tenantId, ref.rules, resolve, { selfSegmentId: opts.selfSegmentId, allowInSegment: false });
      return c.op === "is" ? sql`${schema.customers.id} IN ${members}` : sql`${schema.customers.id} NOT IN ${members}`;
    }

    default:
      // Unreachable: parseSegmentRules rejects unknown fields before compiling.
      throw new SegmentRuleError(`Unknown field "${c.field}"`);
  }
}
