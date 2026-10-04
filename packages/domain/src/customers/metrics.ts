import { sql, type SQL } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";

/**
 * Exact Counted Order Rule per PLAN §0a & orders/state-machine.ts:
 *
 * 1. Payment Eligibility:
 *    - Online payment captured: `payment_status` IN ('paid', 'partially_refunded')
 *    - COD collected: `payment_status` = 'cod_collected'
 * 2. Order Status Eligibility:
 *    - Cancelled orders NEVER count: `orders.status` <> 'cancelled'
 *    - Failed orders NEVER count: `orders.payment_status` <> 'failed'
 * 3. Spend Calculation:
 *    - Net of refunds: `grand_total - COALESCE(refunded_amount, 0)`
 *    - Summed across all eligible orders for the customer.
 * 4. Order Count Calculation:
 *    - A fully refunded order (`net_spend <= 0`) does NOT count towards orders_count.
 *    - Only orders with `net_spend > 0` increment `orders_count`.
 * 5. Returns Count:
 *    - Count of returns rows associated with the customer's orders or customer_id with status not cancelled.
 * 6. Customer Matching:
 *    - Matched by `orders.customer_id = customers.id`, or for legacy/guest unassigned orders by `orders.email = customers.email`.
 */

export interface CustomerMetricsRecord {
  customerId: string;
  ordersCount: number;
  totalSpent: number;
  averageOrderValue: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  returnsCount: number;
}

/**
 * Generates the metrics subquery computing customer metrics from orders and returns in real-time.
 * Used by customer list, detail, search, sorting, and segmentation.
 *
 * Join it to the customers table on `metrics.customer_id = customers.id` (single equality):
 *
 *   .leftJoin(customerMetricsSql(tenantId), sql`${schema.customers.id} = metrics.customer_id`)
 *
 * Shape: grouped aggregates over the tenant's orders and returns (a constant number of linear
 * scans), joined back to customers by customer_id and email. The previous per-customer LATERAL
 * re-scanned the whole orders table once per customer (measured: 6k customers x 24k orders =
 * 13.1M buffer hits for one page of 25) because the OR in the match condition defeats indexes.
 */
export function customerMetricsSql(tenantId: string): SQL {
  // Net spend and "counts as an order" per the rule documented above, shared by both match paths.
  // keySelect/groupKey differ per path: the by-id path groups on customer_id, the guest path on email.
  const ordersAggregate = (match: SQL, keySelect: SQL, groupKey: SQL) => sql`
    SELECT
      ${keySelect},
      COUNT(*) FILTER (WHERE o.counts AND o.net > 0)::int AS orders_count,
      COALESCE(SUM(o.net) FILTER (WHERE o.counts), 0)::bigint AS total_spent,
      MIN(o.placed_at) FILTER (WHERE o.counts AND o.net > 0) AS first_order_at,
      MAX(o.placed_at) FILTER (WHERE o.counts AND o.net > 0) AS last_order_at
    FROM (
      SELECT o2.customer_id, o2.email, o2.placed_at,
        o2.grand_total - COALESCE(ref.refunded, 0) AS net,
        (o2.payment_status IN ('paid', 'partially_refunded') OR o2.payment_status = 'cod_collected')
          AND o2.status <> 'cancelled' AS counts
      FROM ${schema.orders} o2
      LEFT JOIN (
        SELECT order_id, SUM(amount) AS refunded
        FROM ${schema.refunds}
        WHERE tenant_id = ${tenantId} AND status IN ('succeeded', 'processed')
        GROUP BY order_id
      ) ref ON ref.order_id = o2.id
      WHERE o2.tenant_id = ${tenantId} AND ${match}
    ) o
    GROUP BY ${groupKey}
  `;

  return sql`
    (
      SELECT
        cx.id AS customer_id,
        COALESCE(by_id.orders_count, 0) + COALESCE(by_email.orders_count, 0) AS orders_count,
        COALESCE(by_id.total_spent, 0) + COALESCE(by_email.total_spent, 0) AS total_spent,
        CASE
          WHEN COALESCE(by_id.orders_count, 0) + COALESCE(by_email.orders_count, 0) > 0
          THEN ROUND(
            (COALESCE(by_id.total_spent, 0) + COALESCE(by_email.total_spent, 0))::numeric
            / (COALESCE(by_id.orders_count, 0) + COALESCE(by_email.orders_count, 0))
          )
          ELSE 0
        END::bigint AS average_order_value,
        LEAST(by_id.first_order_at, by_email.first_order_at) AS first_order_at,
        GREATEST(by_id.last_order_at, by_email.last_order_at) AS last_order_at,
        COALESCE(returns_by_customer.returns_count, 0) + COALESCE(returns_by_email.returns_count, 0) AS returns_count
      FROM ${schema.customers} cx
      LEFT JOIN (
        ${ordersAggregate(
          sql`o2.customer_id IS NOT NULL`,
          sql`o.customer_id AS customer_id, NULL::citext AS email`,
          sql`o.customer_id`,
        )}
      ) by_id ON by_id.customer_id = cx.id
      LEFT JOIN (
        ${ordersAggregate(
          sql`o2.customer_id IS NULL`,
          sql`NULL::uuid AS customer_id, o.email AS email`,
          sql`o.email`,
        )}
      ) by_email ON by_email.email = cx.email
      LEFT JOIN (
        SELECT key, COUNT(*)::int AS returns_count
        FROM (
          SELECT ret.customer_id AS key
          FROM ${schema.returns} ret
          WHERE ret.tenant_id = ${tenantId} AND ret.status <> 'cancelled' AND ret.customer_id IS NOT NULL
          UNION ALL
          SELECT o.customer_id
          FROM ${schema.returns} ret
          JOIN ${schema.orders} o ON o.tenant_id = ${tenantId} AND o.id = ret.order_id
          WHERE ret.tenant_id = ${tenantId} AND ret.status <> 'cancelled' AND ret.customer_id IS NULL AND o.customer_id IS NOT NULL
        ) k
        GROUP BY key
      ) returns_by_customer ON returns_by_customer.key = cx.id
      LEFT JOIN (
        SELECT o.email, COUNT(*)::int AS returns_count
        FROM ${schema.returns} ret
        JOIN ${schema.orders} o ON o.tenant_id = ${tenantId} AND o.id = ret.order_id
        WHERE ret.tenant_id = ${tenantId} AND ret.status <> 'cancelled' AND ret.customer_id IS NULL AND o.customer_id IS NULL
        GROUP BY o.email
      ) returns_by_email ON returns_by_email.email = cx.email
    ) metrics
  `;
}

/**
 * Recomputes and updates the cached sorting columns (orders_count, total_spent, last_order_at)
 * on a customer row. Invoked by the `customers.refresh_metrics` pg-boss job.
 */
export async function refreshCustomerMetrics(
  db: Db,
  tenantId: string,
  customerId: string,
): Promise<CustomerMetricsRecord | null> {
  return await withTenant(db, tenantId, async (tx) => {
    const query = sql`
      SELECT
        "customers".id AS customer_id,
        metrics.orders_count,
        metrics.total_spent,
        metrics.average_order_value,
        metrics.first_order_at,
        metrics.last_order_at,
        metrics.returns_count
      FROM ${schema.customers}
      LEFT JOIN ${customerMetricsSql(tenantId)} ON ${schema.customers.id} = metrics.customer_id
      WHERE ${schema.customers.tenantId} = ${tenantId} AND ${schema.customers.id} = ${customerId}
      LIMIT 1
    `;

    const result = await tx.execute<{
      customer_id: string;
      orders_count: number;
      total_spent: string | number;
      average_order_value: string | number;
      first_order_at: string | Date | null;
      last_order_at: string | Date | null;
      returns_count: number;
    }>(query);

    const row = result.rows[0];
    if (!row) return null;

    const ordersCount = Number(row.orders_count || 0);
    const totalSpent = Number(row.total_spent || 0);
    const averageOrderValue = Number(row.average_order_value || 0);
    const firstOrderAt = row.first_order_at ? new Date(row.first_order_at) : null;
    const lastOrderAt = row.last_order_at ? new Date(row.last_order_at) : null;
    const returnsCount = Number(row.returns_count || 0);

    // Update sorting cache columns on customer table
    await tx
      .update(schema.customers)
      .set({
        ordersCount,
        totalSpent,
        lastOrderAt,
        updatedAt: new Date(),
      })
      .where(sql`${schema.customers.tenantId} = ${tenantId} AND ${schema.customers.id} = ${customerId}`);

    return {
      customerId: row.customer_id,
      ordersCount,
      totalSpent,
      averageOrderValue,
      firstOrderAt,
      lastOrderAt,
      returnsCount,
    };
  });
}

/**
 * Sweep to repair metrics drift across all customers (run nightly or on demand).
 */
export async function runCustomerMetricsSweep(
  db: Db,
  tenantId?: string,
): Promise<{ processed: number }> {
  const tenantsList = tenantId
    ? [{ id: tenantId }]
    : await db.select({ id: schema.tenants.id }).from(schema.tenants);

  let processed = 0;

  for (const t of tenantsList) {
    await withTenant(db, t.id, async (tx) => {
      const updateResult = await tx.execute(sql`
        WITH computed AS (
          SELECT
            "customers".id AS customer_id,
            metrics.orders_count,
            metrics.total_spent,
            metrics.last_order_at
          FROM ${schema.customers}
          LEFT JOIN ${customerMetricsSql(t.id)} ON ${schema.customers.id} = metrics.customer_id
          WHERE ${schema.customers.tenantId} = ${t.id}
        )
        UPDATE ${schema.customers}
        SET
          orders_count = computed.orders_count,
          total_spent = computed.total_spent,
          last_order_at = computed.last_order_at,
          updated_at = now()
        FROM computed
        WHERE ${schema.customers.id} = computed.customer_id
          AND ${schema.customers.tenantId} = ${t.id}
          AND (
            ${schema.customers.ordersCount} <> computed.orders_count OR
            ${schema.customers.totalSpent} <> computed.total_spent OR
            ${schema.customers.lastOrderAt} IS DISTINCT FROM computed.last_order_at
          )
      `);
      processed += Number(updateResult.rowCount || 0);
    });
  }

  return { processed };
}
