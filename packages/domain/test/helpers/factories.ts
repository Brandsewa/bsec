/**
 * Common test factories for bsec integration tests.
 *
 * Factories:
 * - primaryCategory(rt, ctx): returns a primary category id (cached per tenant)
 * - createActiveProduct(rt, ctx, opts): creates an active product with a variant and stocked inventory
 * - createGuestCheckout(rt, ctx, opts): creates a cart, adds item, and places a COD guest order
 * - createDeliveredCodOrder(rt, ctx, opts): places an order and moves it + fulfillment to delivered
 */
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import {
  addToCart,
  createCategory,
  createProduct,
  getOrCreateCart,
  placeOrder,
  type Runtime,
  type TenantContext,
} from "../../src/index.ts";

const categoryCache = new Map<string, string>();

/** A product needs a primary category to be active (catalog plan Q2); tests that just need an active product share one per store. */
export async function primaryCategory(rt: Runtime, ctx: TenantContext): Promise<string> {
  const hit = categoryCache.get(ctx.tenantId);
  if (hit) return hit;
  const c = await createCategory(rt, ctx, { name: "Test Catalog" });
  categoryCache.set(ctx.tenantId, c.id);
  return c.id;
}

export interface CreateActiveProductOptions {
  title?: string;
  price?: number;
  stock?: number;
  sku?: string;
  returnable?: boolean;
}

export interface ActiveProductResult {
  productId: string;
  variantId: string;
  categoryId: string;
  locationId: string;
  product: Awaited<ReturnType<typeof createProduct>>;
  variant: Awaited<ReturnType<typeof createProduct>>["variants"][0];
}

/**
 * Creates an active product with primary category, variant, and stocked inventory level in one call.
 */
export async function createActiveProduct(
  rt: Runtime,
  ctx: TenantContext,
  opts: CreateActiveProductOptions = {},
): Promise<ActiveProductResult> {
  const categoryId = await primaryCategory(rt, ctx);
  const title = opts.title ?? "Test Product";
  const price = opts.price ?? 10_000;
  const stock = opts.stock ?? 100;
  const sku = opts.sku ?? `SKU-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const product = await createProduct(rt, ctx, {
    title,
    status: "active",
    primaryCategoryId: categoryId,
    returnable: opts.returnable ?? true,
    variants: [{ sku, title: "Default", price }],
  });

  const variant = product.variants[0]!;
  const variantId = variant.id;

  // Find default location
  const [loc] = await withTenant(rt._db.db, ctx.tenantId, async (tx) =>
    tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctx.tenantId)).limit(1),
  );

  let locationId = loc?.id;
  if (!locationId) {
    const [newLoc] = await withTenant(rt._db.db, ctx.tenantId, async (tx) =>
      tx
        .insert(schema.locations)
        .values({
          tenantId: ctx.tenantId,
          name: "Main Warehouse",
          isDefault: true,
        })
        .returning(),
    );
    locationId = newLoc!.id;
  }

  // Stock inventory
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await tx.insert(schema.inventoryLevels).values({
      tenantId: ctx.tenantId,
      locationId: locationId!,
      variantId,
      onHand: stock,
    });
  });

  return {
    productId: product.id,
    variantId,
    categoryId,
    locationId: locationId!,
    product,
    variant,
  };
}

export interface CreateGuestCheckoutOptions {
  variantId: string;
  quantity?: number;
  email?: string;
  name?: string;
  phone?: string;
  shippingAddress?: {
    line1?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  };
}

export interface GuestCheckoutResult {
  orderId: string;
  orderNumber: string;
  cartToken: string;
  customerEmail: string;
}

/**
 * Creates a guest cart, adds items, and places a COD order.
 */
export async function createGuestCheckout(
  rt: Runtime,
  ctx: TenantContext,
  opts: CreateGuestCheckoutOptions,
): Promise<GuestCheckoutResult> {
  const cart = await getOrCreateCart(rt, ctx, undefined);
  await addToCart(rt, ctx, {
    token: cart.token,
    variantId: opts.variantId,
    quantity: opts.quantity ?? 1,
  });

  const email = opts.email ?? `shopper-${Date.now().toString(36)}@example.com`;
  const name = opts.name ?? "Test Shopper";
  const phone = opts.phone ?? "+919876543210";

  const placed = await placeOrder(rt, ctx, {
    cartToken: cart.token,
    email,
    phone,
    fullName: name,
    addressLine1: opts.shippingAddress?.line1 ?? "123 MG Road",
    city: opts.shippingAddress?.city ?? "Bengaluru",
    state: opts.shippingAddress?.state ?? "Karnataka",
    pincode: opts.shippingAddress?.pincode ?? "560001",
    country: opts.shippingAddress?.country ?? "IN",
    paymentMethod: "cod",
  });

  return {
    orderId: placed.orderId,
    orderNumber: placed.orderNumber,
    cartToken: cart.token,
    customerEmail: email,
  };
}

export interface CreateDeliveredCodOrderOptions extends CreateGuestCheckoutOptions {
  locationId?: string;
}

export interface DeliveredCodOrderResult extends GuestCheckoutResult {
  orderItemId: string;
  items: Array<{ id: string; orderId: string; variantId: string; quantity: number }>;
}

/**
 * Places a COD order and advances it + fulfillment directly to delivered status.
 */
export async function createDeliveredCodOrder(
  rt: Runtime,
  ctx: TenantContext,
  opts: CreateDeliveredCodOrderOptions,
): Promise<DeliveredCodOrderResult> {
  const checkout = await createGuestCheckout(rt, ctx, opts);

  let locationId = opts.locationId;
  if (!locationId) {
    const [loc] = await withTenant(rt._db.db, ctx.tenantId, async (tx) =>
      tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctx.tenantId)).limit(1),
    );
    locationId = loc?.id;
  }

  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await tx.update(schema.orders).set({ status: "delivered" }).where(eq(schema.orders.id, checkout.orderId));
    if (locationId) {
      await tx.insert(schema.fulfillments).values({
        tenantId: ctx.tenantId,
        orderId: checkout.orderId,
        locationId,
        status: "delivered",
        deliveredAt: new Date(),
      });
    }
  });

  const items = await withTenant(rt._db.db, ctx.tenantId, async (tx) =>
    tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, checkout.orderId)),
  );

  return {
    ...checkout,
    orderItemId: items[0]!.id,
    items,
  };
}
