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
 * Generates the lateral SQL subquery fragment computing customer metrics from orders and returns in real-time.
 * Used by customer list, detail, search, sorting, and segmentation.
 */
export function customerMetricsSql(tenantId: string): SQL {
  return sql`
    LATERAL (
      SELECT
        COUNT(ord.id) FILTER (
          WHERE (ord.payment_status IN ('paid', 'partially_refunded') OR ord.payment_status = 'cod_collected')
            AND ord.status <> 'cancelled'
            AND (ord.grand_total - COALESCE(ref.refunded, 0)) > 0
        )::int AS orders_count,
        COALESCE(
          SUM(ord.grand_total - COALESCE(ref.refunded, 0)) FILTER (
            WHERE (ord.payment_status IN ('paid', 'partially_refunded') OR ord.payment_status = 'cod_collected')
              AND ord.status <> 'cancelled'
          ),
          0
        )::bigint AS total_spent,
        COALESCE(
          ROUND(
            AVG(ord.grand_total - COALESCE(ref.refunded, 0)) FILTER (
              WHERE (ord.payment_status IN ('paid', 'partially_refunded') OR ord.payment_status = 'cod_collected')
                AND ord.status <> 'cancelled'
                AND (ord.grand_total - COALESCE(ref.refunded, 0)) > 0
            )
          ),
          0
        )::bigint AS average_order_value,
        MIN(ord.placed_at) FILTER (
          WHERE (ord.payment_status IN ('paid', 'partially_refunded') OR ord.payment_status = 'cod_collected')
            AND ord.status <> 'cancelled'
            AND (ord.grand_total - COALESCE(ref.refunded, 0)) > 0
        ) AS first_order_at,
        MAX(ord.placed_at) FILTER (
          WHERE (ord.payment_status IN ('paid', 'partially_refunded') OR ord.payment_status = 'cod_collected')
            AND ord.status <> 'cancelled'
            AND (ord.grand_total - COALESCE(ref.refunded, 0)) > 0
        ) AS last_order_at,
        (
          SELECT COUNT(*)::int
          FROM ${schema.returns} ret
          WHERE ret.tenant_id = ${tenantId}
            AND (ret.customer_id = ${schema.customers.id} OR ret.order_id IN (
              SELECT o2.id FROM ${schema.orders} o2
              WHERE o2.tenant_id = ${tenantId}
                AND (o2.customer_id = ${schema.customers.id} OR (o2.customer_id IS NULL AND o2.email = ${schema.customers.email}))
            ))
            AND ret.status <> 'cancelled'
        )::int AS returns_count
      FROM (
        SELECT id, payment_status, status, grand_total, placed_at, tenant_id
        FROM ${schema.orders} o
        WHERE o.tenant_id = ${tenantId}
          AND (o.customer_id = ${schema.customers.id} OR (o.customer_id IS NULL AND o.email = ${schema.customers.email}))
      ) ord
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(r.amount), 0)::bigint AS refunded
        FROM ${schema.refunds} r
        WHERE r.tenant_id = ${tenantId}
          AND r.order_id = ord.id
          AND r.status IN ('succeeded', 'processed')
      ) ref ON true
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
      CROSS JOIN ${customerMetricsSql(tenantId)}
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
          CROSS JOIN ${customerMetricsSql(t.id)}
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
