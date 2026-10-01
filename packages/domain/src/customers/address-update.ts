import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, notInArray } from "drizzle-orm";
import { type Db, actionTokens, fulfillments, orderEvents, orders, withTenant } from "@bs/db";

/** A shopper has three days from the email to fix the address. */
const ADDRESS_UPDATE_TTL_MS = 3 * 86_400_000;

/** The address can only change while nothing has physically left: an order in these states, with no fulfillment past a label. */
const EDITABLE_ORDER_STATUSES: readonly string[] = ["pending", "confirmed", "processing"];
/** Fulfillment states that do not block an edit; anything else (picked up, in transit, delivered...) is already moving. */
const NON_BLOCKING_FULFILLMENT_STATUSES = ["pending", "label_created", "cancelled"];

const hashToken = (raw: string): string => createHash("sha256").update(raw.trim()).digest("hex");

export interface ShippingAddress {
  fullName: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface AddressUpdateView {
  orderNumber: string;
  orderStatus: string;
  address: ShippingAddress;
  /** False once the parcel is on its way or the order is closed; the page then explains why. */
  editable: boolean;
}

export interface AddressUpdateInput {
  fullName: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  city: string;
  state: string;
  pincode: string;
}

/** Mints a "fix my delivery address" link token for an order (3 days). Only the hash is stored. */
export async function mintAddressUpdateToken(db: Db, tenantId: string, orderId: string): Promise<string> {
  const raw = `adr_${randomBytes(24).toString("hex")}`;
  await withTenant(db, tenantId, async (tx) => {
    const [o] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
    if (!o) throw new Error("Not Found: Order not found");
    await tx.insert(actionTokens).values({
      tenantId,
      purpose: "address_update",
      targetId: orderId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + ADDRESS_UPDATE_TTL_MS),
    });
  });
  return raw;
}

function toAddress(raw: unknown): ShippingAddress {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    fullName: s(a.fullName),
    addressLine1: s(a.addressLine1),
    ...(s(a.addressLine2) ? { addressLine2: s(a.addressLine2) } : {}),
    city: s(a.city),
    state: s(a.state),
    pincode: s(a.pincode),
    country: s(a.country) || "IN",
  };
}

/** Finds the order behind a token. With `lock`, the order row is held so a fulfilment cannot slip in between our check and our write. */
async function loadForToken(tx: Db, tenantId: string, token: string, lock: boolean) {
  const [t] = await tx
    .select({ targetId: actionTokens.targetId })
    .from(actionTokens)
    .where(
      and(
        eq(actionTokens.tenantId, tenantId),
        eq(actionTokens.purpose, "address_update"),
        eq(actionTokens.tokenHash, hashToken(token)),
        gt(actionTokens.expiresAt, new Date()),
      ),
    );
  if (!t) return null;
  const query = tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, t.targetId)));
  const [order] = await (lock ? query.for("update") : query);
  if (!order) return null;

  const blocking = await tx
    .select({ id: fulfillments.id })
    .from(fulfillments)
    .where(
      and(
        eq(fulfillments.tenantId, tenantId),
        eq(fulfillments.orderId, order.id),
        notInArray(fulfillments.status, NON_BLOCKING_FULFILLMENT_STATUSES),
      ),
    )
    .limit(1);
  const editable = EDITABLE_ORDER_STATUSES.includes(order.status) && blocking.length === 0;
  return { order, editable };
}

/** What the address page shows for a token; null for an unknown, expired or other-store link. */
export async function getAddressUpdateView(db: Db, tenantId: string, token: string): Promise<AddressUpdateView | null> {
  return await withTenant(db, tenantId, async (tx) => {
    const found = await loadForToken(tx, tenantId, token, false);
    if (!found) return null;
    return {
      orderNumber: found.order.number,
      orderStatus: found.order.status,
      address: toAddress(found.order.shippingAddress),
      editable: found.editable,
    };
  });
}

const PINCODE = /^[1-9][0-9]{5}$/;

function clean(input: AddressUpdateInput): ShippingAddress {
  const t = (v: string | undefined) => (v ?? "").trim().replace(/\s+/g, " ");
  const out: ShippingAddress = {
    fullName: t(input.fullName),
    addressLine1: t(input.addressLine1),
    ...(t(input.addressLine2) ? { addressLine2: t(input.addressLine2) } : {}),
    city: t(input.city),
    state: t(input.state),
    pincode: t(input.pincode),
    country: "IN",
  };
  if (!out.fullName || !out.addressLine1 || !out.city || !out.state) throw new Error("Bad Request: Fill in your name, address, city and state");
  if (!PINCODE.test(out.pincode)) throw new Error("Bad Request: Enter a valid 6-digit pincode");
  if (out.fullName.length > 120 || out.addressLine1.length > 200 || (out.addressLine2?.length ?? 0) > 200 || out.city.length > 80 || out.state.length > 80) {
    throw new Error("Bad Request: One of the fields is too long");
  }
  return out;
}

/**
 * Replaces the delivery address on the order behind the token and writes an order event. The token stays valid for
 * further corrections until it expires or the order starts moving. Throws "Not Found" for a bad link and "Precondition"
 * once the address can no longer change.
 */
export async function updateOrderAddressByToken(db: Db, tenantId: string, token: string, input: AddressUpdateInput): Promise<ShippingAddress> {
  const next = clean(input);
  return await withTenant(db, tenantId, async (tx) => {
    const found = await loadForToken(tx, tenantId, token, true);
    if (!found) throw new Error("Not Found: This link is not valid any more");
    if (!found.editable) throw new Error("Precondition: This order has already been handed over for delivery, so the address can no longer be changed");

    const previous = toAddress(found.order.shippingAddress);
    // Keep any extra keys the order carries and replace the address fields.
    const merged: Record<string, unknown> = { ...(found.order.shippingAddress as Record<string, unknown>), ...next };
    if (!next.addressLine2) delete merged.addressLine2;
    await tx
      .update(orders)
      .set({ shippingAddress: merged, updatedAt: new Date() })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, found.order.id)));
    await tx.insert(orderEvents).values({
      tenantId,
      orderId: found.order.id,
      type: "order.address_updated",
      message: "Customer corrected the delivery address",
      data: { previous, next },
      actorType: "customer",
      visibleToCustomer: true,
    });
    return next;
  });
}
