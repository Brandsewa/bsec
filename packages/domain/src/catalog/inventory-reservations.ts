import { eq, sql } from "drizzle-orm";
import {
  type Db,
  withTenant,
  inventoryReservations,
  inventoryMovements,
  tenants,
} from "@bs/db";

export class InsufficientInventoryError extends Error {
  public readonly variantId: string;
  public readonly locationId: string;
  public readonly requestedQty: number;

  constructor(variantId: string, locationId: string, requestedQty: number) {
    super(`Insufficient inventory for variant ${variantId} at location ${locationId} (requested ${requestedQty})`);
    this.name = "InsufficientInventoryError";
    this.variantId = variantId;
    this.locationId = locationId;
    this.requestedQty = requestedQty;
  }
}

export interface ReserveItemInput {
  variantId: string;
  locationId: string;
  qty: number;
}

export interface ReserveMeta {
  orderId?: string | undefined;
  cartId?: string | undefined;
  ttlMinutes?: number | undefined;
}

export interface InventoryReservationRecord {
  id: string;
  variantId: string;
  locationId: string;
  orderId: string | null;
  cartId: string | null;
  qty: number;
  status: string;
  expiresAt: Date;
}

/**
 * Reserve inventory for items using the guarded UPDATE pattern (PLAN §11.3).
 *
 * Pattern:
 *   UPDATE inventory_levels
 *      SET reserved = reserved + $qty
 *    WHERE tenant_id = $t AND variant_id = $v AND location_id = $l
 *      AND on_hand - reserved >= $qty
 *   RETURNING id;
 *
 * If any item cannot be reserved, throws InsufficientInventoryError and aborts transaction.
 */
export async function reserveInventory(
  db: Db,
  tenantId: string,
  items: ReserveItemInput[],
  meta?: ReserveMeta,
): Promise<InventoryReservationRecord[]> {
  if (items.length === 0) return [];

  // Sort items deterministically by (variantId, locationId) to prevent cross-transaction deadlocks
  const sortedItems = [...items].sort((a, b) => {
    const vCmp = a.variantId.localeCompare(b.variantId);
    if (vCmp !== 0) return vCmp;
    return a.locationId.localeCompare(b.locationId);
  });

  const ttlMinutes = meta?.ttlMinutes ?? 30;

  return await withTenant(db, tenantId, async (tx) => {
    const createdReservations: InventoryReservationRecord[] = [];

    for (const item of sortedItems) {
      if (item.qty <= 0) continue;

      // 1. Guarded atomic update
      const updateRes = await tx.execute<{ id: string }>(sql`
        UPDATE inventory_levels
           SET reserved = reserved + ${item.qty},
               updated_at = now()
         WHERE tenant_id = ${tenantId}
           AND variant_id = ${item.variantId}
           AND location_id = ${item.locationId}
           AND (on_hand - reserved) >= ${item.qty}
        RETURNING id;
      `);

      if (updateRes.rows.length === 0) {
        throw new InsufficientInventoryError(item.variantId, item.locationId, item.qty);
      }

      // 2. Insert active reservation row
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
      const inserted = await tx
        .insert(inventoryReservations)
        .values({
          tenantId,
          variantId: item.variantId,
          locationId: item.locationId,
          orderId: meta?.orderId ?? null,
          cartId: meta?.cartId ?? null,
          qty: item.qty,
          status: "active",
          expiresAt,
        })
        .returning();

      const r = inserted[0];
      if (!r) {
        throw new Error("Failed to insert reservation record");
      }
      createdReservations.push({
        id: r.id,
        variantId: r.variantId,
        locationId: r.locationId,
        orderId: r.orderId,
        cartId: r.cartId,
        qty: r.qty,
        status: r.status,
        expiresAt: r.expiresAt,
      });
    }

    return createdReservations;
  });
}

/**
 * Commit active reservations on successful payment (PLAN §11.3).
 *
 * "On payment: reservation -> committed, on_hand and reserved both decrease, movement row sold."
 * Idempotent: only modifies active reservations.
 */
export async function commitReservation(
  db: Db,
  tenantId: string,
  opts: { orderId?: string | undefined; reservationIds?: string[] | undefined },
): Promise<{ committedCount: number }> {
  return await withTenant(db, tenantId, async (tx) => {
    // Find active reservations matching criteria with FOR UPDATE
    let query = sql`
      SELECT id, variant_id, location_id, qty, order_id
        FROM inventory_reservations
       WHERE tenant_id = ${tenantId}
         AND status = 'active'
    `;

    if (opts.orderId) {
      query = sql`${query} AND order_id = ${opts.orderId}`;
    } else if (opts.reservationIds && opts.reservationIds.length > 0) {
      const idList = opts.reservationIds.map((id) => sql`${id}::uuid`);
      query = sql`${query} AND id IN (${sql.join(idList, sql`, `)})`;
    } else {
      return { committedCount: 0 };
    }

    query = sql`${query} FOR UPDATE`;

    const activeRowsRes = await tx.execute<{
      id: string;
      variant_id: string;
      location_id: string;
      qty: number;
      order_id: string | null;
    }>(query);

    const activeRows = activeRowsRes.rows;
    if (activeRows.length === 0) {
      return { committedCount: 0 };
    }

    for (const row of activeRows) {
      // 1. Mark reservation committed
      await tx
        .update(inventoryReservations)
        .set({ status: "committed", updatedAt: new Date() })
        .where(eq(inventoryReservations.id, row.id));

      // 2. Decrease on_hand and reserved
      await tx.execute(sql`
        UPDATE inventory_levels
           SET on_hand = on_hand - ${row.qty},
               reserved = reserved - ${row.qty},
               updated_at = now()
         WHERE tenant_id = ${tenantId}
           AND variant_id = ${row.variant_id}
           AND location_id = ${row.location_id};
      `);

      // 3. Write movement ledger
      await tx.insert(inventoryMovements).values({
        tenantId,
        variantId: row.variant_id,
        locationId: row.location_id,
        delta: -row.qty,
        reason: "sold",
        referenceType: "order",
        referenceId: opts.orderId ?? row.order_id,
      });
    }

    return { committedCount: activeRows.length };
  });
}

/**
 * Gives back stock an order already took. Confirming (COD) or paying an order commits its reservations:
 * the units leave on_hand and the reservation becomes 'committed', which releaseReservation (active only)
 * never touches. When the order is cancelled before anything shipped, those units are still on the shelf,
 * so they go back to on_hand, one movement per line, and the reservation is closed as 'returned_to_stock'.
 * Idempotent: a second call finds nothing committed.
 */
export async function restoreCommittedStock(
  db: Db,
  tenantId: string,
  opts: { orderId: string },
): Promise<{ restoredLines: number; restoredUnits: number }> {
  return await withTenant(db, tenantId, async (tx) => {
    const res = await tx.execute<{ id: string; variant_id: string; location_id: string; qty: number }>(sql`
      SELECT id, variant_id, location_id, qty
        FROM inventory_reservations
       WHERE tenant_id = ${tenantId}
         AND order_id = ${opts.orderId}
         AND status = 'committed'
         FOR UPDATE
    `);

    let units = 0;
    for (const row of res.rows) {
      await tx
        .update(inventoryReservations)
        .set({ status: "returned_to_stock", updatedAt: new Date() })
        .where(eq(inventoryReservations.id, row.id));

      await tx.execute(sql`
        UPDATE inventory_levels
           SET on_hand = on_hand + ${row.qty},
               updated_at = now()
         WHERE tenant_id = ${tenantId}
           AND variant_id = ${row.variant_id}
           AND location_id = ${row.location_id};
      `);

      await tx.insert(inventoryMovements).values({
        tenantId,
        variantId: row.variant_id,
        locationId: row.location_id,
        delta: row.qty,
        reason: "cancelled",
        referenceType: "order",
        referenceId: opts.orderId,
      });
      units += row.qty;
    }

    return { restoredLines: res.rows.length, restoredUnits: units };
  });
}

/**
 * Release reservations manually (e.g. order cancelled, checkout abandoned) (PLAN §11.3).
 * Idempotent: only active reservations are released and reserved count decremented.
 */
export async function releaseReservation(
  db: Db,
  tenantId: string,
  opts: {
    reservationIds?: string[] | undefined;
    orderId?: string | undefined;
    cartId?: string | undefined;
    reason?: "cancelled" | "expired" | undefined;
  },
): Promise<{ releasedCount: number }> {
  const newStatus = opts.reason === "expired" ? "expired" : "released";

  return await withTenant(db, tenantId, async (tx) => {
    let query = sql`
      SELECT id, variant_id, location_id, qty
        FROM inventory_reservations
       WHERE tenant_id = ${tenantId}
         AND status = 'active'
    `;

    if (opts.orderId) {
      query = sql`${query} AND order_id = ${opts.orderId}`;
    } else if (opts.cartId) {
      query = sql`${query} AND cart_id = ${opts.cartId}`;
    } else if (opts.reservationIds && opts.reservationIds.length > 0) {
      const idList = opts.reservationIds.map((id) => sql`${id}::uuid`);
      query = sql`${query} AND id IN (${sql.join(idList, sql`, `)})`;
    } else {
      return { releasedCount: 0 };
    }

    query = sql`${query} FOR UPDATE`;

    const activeRowsRes = await tx.execute<{
      id: string;
      variant_id: string;
      location_id: string;
      qty: number;
    }>(query);

    const activeRows = activeRowsRes.rows;
    if (activeRows.length === 0) {
      return { releasedCount: 0 };
    }

    for (const row of activeRows) {
      await tx
        .update(inventoryReservations)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(inventoryReservations.id, row.id));

      await tx.execute(sql`
        UPDATE inventory_levels
           SET reserved = reserved - ${row.qty},
               updated_at = now()
         WHERE tenant_id = ${tenantId}
           AND variant_id = ${row.variant_id}
           AND location_id = ${row.location_id};
      `);
    }

    return { releasedCount: activeRows.length };
  });
}

/**
 * Background job to release expired reservations past expires_at (PLAN §11.3).
 * "Expiry job releases active reservations past expires_at; release is idempotent (only active rows change)."
 */
export async function expireOldReservations(
  db: Db,
  tenantId?: string | undefined,
): Promise<{ expiredCount: number }> {
  if (tenantId) {
    return await expireTenantOldReservations(db, tenantId);
  }

  // Iterate all tenants and expire for each
  const allTenants = await db.select({ id: tenants.id }).from(tenants);
  let totalExpired = 0;
  for (const t of allTenants) {
    const res = await expireTenantOldReservations(db, t.id);
    totalExpired += res.expiredCount;
  }
  return { expiredCount: totalExpired };
}

async function expireTenantOldReservations(
  db: Db,
  tenantId: string,
): Promise<{ expiredCount: number }> {
  return await withTenant(db, tenantId, async (tx) => {
    // Select active reservations where expires_at < now()
    const expiredRowsRes = await tx.execute<{
      id: string;
      variant_id: string;
      location_id: string;
      qty: number;
    }>(sql`
      SELECT id, variant_id, location_id, qty
        FROM inventory_reservations
       WHERE tenant_id = ${tenantId}
         AND status = 'active'
         AND expires_at < now()
       FOR UPDATE SKIP LOCKED
       LIMIT 100;
    `);

    const rows = expiredRowsRes.rows;

    for (const row of rows) {
      await tx
        .update(inventoryReservations)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(inventoryReservations.id, row.id));

      await tx.execute(sql`
        UPDATE inventory_levels
           SET reserved = reserved - ${row.qty},
               updated_at = now()
         WHERE tenant_id = ${tenantId}
           AND variant_id = ${row.variant_id}
           AND location_id = ${row.location_id};
      `);
    }

    // Safety net: stock still held by an order that was cancelled (orders cancelled before cancelling released
    // stock, or any path that missed it) goes back too. Idempotent: only active rows change.
    const orphanRowsRes = await tx.execute<{
      id: string;
      variant_id: string;
      location_id: string;
      qty: number;
    }>(sql`
      SELECT r.id, r.variant_id, r.location_id, r.qty
        FROM inventory_reservations r
        JOIN orders o ON o.tenant_id = r.tenant_id AND o.id = r.order_id
       WHERE r.tenant_id = ${tenantId}
         AND r.status = 'active'
         AND o.status = 'cancelled'
       FOR UPDATE OF r SKIP LOCKED
       LIMIT 100;
    `);

    for (const row of orphanRowsRes.rows) {
      await tx
        .update(inventoryReservations)
        .set({ status: "released", updatedAt: new Date() })
        .where(eq(inventoryReservations.id, row.id));

      await tx.execute(sql`
        UPDATE inventory_levels
           SET reserved = reserved - ${row.qty},
               updated_at = now()
         WHERE tenant_id = ${tenantId}
           AND variant_id = ${row.variant_id}
           AND location_id = ${row.location_id};
      `);
    }

    // Same safety net for payments: a cancelled order with an unpaid payment shows no payment due.
    await tx.execute(sql`
      UPDATE payment_intents pi
         SET status = 'cancelled', updated_at = now()
        FROM orders o
       WHERE pi.tenant_id = ${tenantId}
         AND o.tenant_id = pi.tenant_id
         AND o.id = pi.order_id
         AND o.status = 'cancelled'
         AND pi.status IN ('created', 'requires_action', 'cod_pending');
    `);
    await tx.execute(sql`
      UPDATE orders
         SET payment_status = 'cancelled', updated_at = now()
       WHERE tenant_id = ${tenantId}
         AND status = 'cancelled'
         AND payment_status IN ('pending', 'created', 'requires_action', 'cod_pending');
    `);

    return { expiredCount: rows.length + orphanRowsRes.rows.length };
  });
}
