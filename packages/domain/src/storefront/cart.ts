import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { calculateShippingRate } from "../orders/shipping-rates.ts";

export interface StorefrontCartItem {
  id: string;
  cartId: string;
  variantId: string;
  quantity: number;
  unitPriceSnapshot: number;
  lineTotal: number;
  properties: Record<string, unknown> | null;
  product: {
    id: string;
    title: string;
    slug: string;
  };
  variant: {
    id: string;
    sku: string;
    title: string;
    optionValues: Record<string, string> | null;
    price: number;
  };
  primaryImage: {
    mediaId: string;
    alt: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface StorefrontCart {
  id: string;
  token: string;
  currency: string;
  items: StorefrontCartItem[];
  itemCount: number;
  subtotal: number;
  lastActivityAt: string;
  createdAt: string;
}

export interface ShippingRate {
  id: string;
  title: string;
  description: string;
  amount: number;
  estimatedDays: string;
}

export interface ShippingEstimate {
  serviceable: boolean;
  pincode: string;
  rates: ShippingRate[];
}

export interface AddToCartInput {
  token: string;
  variantId: string;
  quantity: number;
  properties?: Record<string, unknown> | undefined;
}

export interface UpdateCartItemQuantityInput {
  token: string;
  itemId: string;
  quantity: number;
}

export interface RemoveCartItemInput {
  token: string;
  itemId: string;
}

export interface EstimateCartShippingInput {
  token: string;
  pincode: string;
}

/**
 * Loads a full cart with its line items joined with variant, product, and primary media.
 */
async function loadCartWithItems(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  cartRecord: typeof schema.carts.$inferSelect,
): Promise<StorefrontCart> {
  const rawItems = await tx
    .select({
      item: schema.cartItems,
      variant: {
        id: schema.variants.id,
        sku: schema.variants.sku,
        title: schema.variants.title,
        optionValues: schema.variants.optionValues,
        price: schema.variants.price,
      },
      product: {
        id: schema.products.id,
        title: schema.products.title,
        slug: schema.products.slug,
      },
      primaryMedia: {
        mediaId: schema.productMedia.mediaId,
        alt: schema.productMedia.alt,
      },
    })
    .from(schema.cartItems)
    .innerJoin(
      schema.variants,
      and(
        eq(schema.variants.tenantId, schema.cartItems.tenantId),
        eq(schema.variants.id, schema.cartItems.variantId),
      ),
    )
    .innerJoin(
      schema.products,
      and(
        eq(schema.products.tenantId, schema.variants.tenantId),
        eq(schema.products.id, schema.variants.productId),
      ),
    )
    .leftJoin(
      schema.productMedia,
      and(
        eq(schema.productMedia.tenantId, schema.products.tenantId),
        eq(schema.productMedia.productId, schema.products.id),
        eq(schema.productMedia.position, 0),
      ),
    )
    .where(eq(schema.cartItems.cartId, cartRecord.id))
    .orderBy(schema.cartItems.createdAt);

  let itemCount = 0;
  let subtotal = 0;

  const items: StorefrontCartItem[] = rawItems.map((r) => {
    const qty = r.item.quantity;
    const unitPrice = Number(r.item.unitPriceSnapshot);
    const lineTotal = unitPrice * qty;

    itemCount += qty;
    subtotal += lineTotal;

    return {
      id: r.item.id,
      cartId: r.item.cartId,
      variantId: r.item.variantId,
      quantity: qty,
      unitPriceSnapshot: unitPrice,
      lineTotal,
      properties: (r.item.properties as Record<string, unknown>) ?? null,
      product: {
        id: r.product.id,
        title: r.product.title,
        slug: r.product.slug,
      },
      variant: {
        id: r.variant.id,
        sku: r.variant.sku,
        title: r.variant.title,
        optionValues: (r.variant.optionValues as Record<string, string>) ?? null,
        price: Number(r.variant.price),
      },
      primaryImage: r.primaryMedia?.mediaId
        ? {
            mediaId: r.primaryMedia.mediaId,
            alt: r.primaryMedia.alt,
          }
        : null,
      createdAt:
        r.item.createdAt instanceof Date
          ? r.item.createdAt.toISOString()
          : String(r.item.createdAt),
      updatedAt:
        r.item.updatedAt instanceof Date
          ? r.item.updatedAt.toISOString()
          : String(r.item.updatedAt),
    };
  });

  return {
    id: cartRecord.id,
    token: cartRecord.token,
    currency: cartRecord.currency,
    items,
    itemCount,
    subtotal,
    lastActivityAt:
      cartRecord.lastActivityAt instanceof Date
        ? cartRecord.lastActivityAt.toISOString()
        : String(cartRecord.lastActivityAt),
    createdAt:
      cartRecord.createdAt instanceof Date
        ? cartRecord.createdAt.toISOString()
        : String(cartRecord.createdAt),
  };
}

/**
 * Looks up active cart by token and tenantId. If not found, generates a new UUID token and creates a cart row.
 */
export async function getOrCreateCart(
  rt: Runtime,
  ctx: TenantContext,
  token?: string,
  txOrDb?: Parameters<Parameters<typeof withTenant>[2]>[0],
): Promise<StorefrontCart> {
  const runWithTx = async (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => {
    let cartRecord: typeof schema.carts.$inferSelect | undefined;

    if (token) {
      const rows = await tx
        .select()
        .from(schema.carts)
        .where(eq(schema.carts.token, token))
        .limit(1);
      cartRecord = rows[0];
    }

    if (!cartRecord) {
      const newToken = crypto.randomUUID();
      const [newCart] = await tx
        .insert(schema.carts)
        .values({
          token: newToken,
          tenantId: ctx.tenantId,
          currency: "INR",
          status: "active",
        })
        .returning();

      if (!newCart) {
        throw new Error("Failed to create cart");
      }
      cartRecord = newCart;
    }

    return loadCartWithItems(tx, cartRecord);
  };

  if (txOrDb) {
    return runWithTx(txOrDb);
  }

  const db = rt._db.db;
  return withTenant(db, ctx.tenantId, runWithTx);
}

/**
 * Adds an item to a cart or increments quantity if it already exists.
 */
export async function addToCart(
  rt: Runtime,
  ctx: TenantContext,
  input: AddToCartInput,
): Promise<StorefrontCart> {
  if (!input.quantity || input.quantity <= 0) {
    throw new Error("Quantity must be greater than zero");
  }

  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    // 1. Verify cart exists
    const [cartRecord] = await tx
      .select()
      .from(schema.carts)
      .where(eq(schema.carts.token, input.token))
      .limit(1);

    if (!cartRecord) {
      throw new Error("Cart not found");
    }

    // 2. Verify variant belongs to a published, non-deleted product
    const variantRows = await tx
      .select({
        variant: schema.variants,
        product: schema.products,
      })
      .from(schema.variants)
      .innerJoin(
        schema.products,
        and(
          eq(schema.products.tenantId, schema.variants.tenantId),
          eq(schema.products.id, schema.variants.productId),
        ),
      )
      .where(
        and(
          eq(schema.variants.id, input.variantId),
          eq(schema.products.status, "published"),
          sql`${schema.products.deletedAt} IS NULL`,
        ),
      )
      .limit(1);

    const variantData = variantRows[0];
    if (!variantData) {
      throw new Error("Variant not found or product is not available");
    }

    const unitPriceSnapshot = Number(variantData.variant.price);

    // 3. Upsert into cartItems: increment quantity if already exists
    await tx
      .insert(schema.cartItems)
      .values({
        cartId: cartRecord.id,
        variantId: input.variantId,
        quantity: input.quantity,
        unitPriceSnapshot,
        properties: input.properties ?? null,
        tenantId: ctx.tenantId,
      })
      .onConflictDoUpdate({
        target: [schema.cartItems.tenantId, schema.cartItems.cartId, schema.cartItems.variantId],
        set: {
          quantity: sql`${schema.cartItems.quantity} + ${input.quantity}`,
          unitPriceSnapshot,
          updatedAt: sql`now()`,
        },
      });

    // 4. Update cart lastActivityAt
    await tx
      .update(schema.carts)
      .set({
        lastActivityAt: sql`now()`,
      })
      .where(eq(schema.carts.id, cartRecord.id));

    return loadCartWithItems(tx, cartRecord);
  });
}

/**
 * Updates the quantity of a cart item. If quantity <= 0, deletes the item.
 */
export async function updateCartItemQuantity(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateCartItemQuantityInput,
): Promise<StorefrontCart> {
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [cartRecord] = await tx
      .select()
      .from(schema.carts)
      .where(eq(schema.carts.token, input.token))
      .limit(1);

    if (!cartRecord) {
      throw new Error("Cart not found");
    }

    if (input.quantity <= 0) {
      await tx
        .delete(schema.cartItems)
        .where(
          and(
            eq(schema.cartItems.id, input.itemId),
            eq(schema.cartItems.cartId, cartRecord.id),
          ),
        );
    } else {
      await tx
        .update(schema.cartItems)
        .set({
          quantity: input.quantity,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.cartItems.id, input.itemId),
            eq(schema.cartItems.cartId, cartRecord.id),
          ),
        );
    }

    await tx
      .update(schema.carts)
      .set({
        lastActivityAt: sql`now()`,
      })
      .where(eq(schema.carts.id, cartRecord.id));

    return loadCartWithItems(tx, cartRecord);
  });
}

/**
 * Removes an item from the cart.
 */
export async function removeCartItem(
  rt: Runtime,
  ctx: TenantContext,
  input: RemoveCartItemInput,
): Promise<StorefrontCart> {
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [cartRecord] = await tx
      .select()
      .from(schema.carts)
      .where(eq(schema.carts.token, input.token))
      .limit(1);

    if (!cartRecord) {
      throw new Error("Cart not found");
    }

    await tx
      .delete(schema.cartItems)
      .where(
        and(
          eq(schema.cartItems.id, input.itemId),
          eq(schema.cartItems.cartId, cartRecord.id),
        ),
      );

    await tx
      .update(schema.carts)
      .set({
        lastActivityAt: sql`now()`,
      })
      .where(eq(schema.carts.id, cartRecord.id));

    return loadCartWithItems(tx, cartRecord);
  });
}

/**
 * Clears all items in the cart.
 */
export async function clearCart(
  rt: Runtime,
  ctx: TenantContext,
  token: string,
  txOrDb?: Parameters<Parameters<typeof withTenant>[2]>[0],
): Promise<StorefrontCart> {
  const runWithTx = async (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => {
    const [cartRecord] = await tx
      .select()
      .from(schema.carts)
      .where(eq(schema.carts.token, token))
      .limit(1);

    if (!cartRecord) {
      throw new Error("Cart not found");
    }

    await tx
      .delete(schema.cartItems)
      .where(eq(schema.cartItems.cartId, cartRecord.id));

    await tx
      .update(schema.carts)
      .set({
        lastActivityAt: sql`now()`,
      })
      .where(eq(schema.carts.id, cartRecord.id));

    return loadCartWithItems(tx, cartRecord);
  };

  if (txOrDb) {
    return runWithTx(txOrDb);
  }

  const db = rt._db.db;
  return withTenant(db, ctx.tenantId, runWithTx);
}

/**
 * Validates Indian pincode format and computes shipping rates based on cart subtotal.
 */
export async function estimateCartShipping(
  rt: Runtime,
  ctx: TenantContext,
  input: EstimateCartShippingInput,
): Promise<ShippingEstimate> {
  const pincodeRegex = /^[1-9][0-9]{5}$/;
  if (!pincodeRegex.test(input.pincode)) {
    throw new Error("Invalid Indian pincode format");
  }

  const cart = await getOrCreateCart(rt, ctx, input.token);

  const standard = calculateShippingRate(cart.subtotal, "standard");
  const express = calculateShippingRate(cart.subtotal, "express");

  return {
    serviceable: true,
    pincode: input.pincode,
    rates: [
      {
        id: standard.method,
        title: standard.title,
        description: standard.description,
        amount: standard.amount,
        estimatedDays: standard.estimatedDays,
      },
      {
        id: express.method,
        title: express.title,
        description: express.description,
        amount: express.amount,
        estimatedDays: express.estimatedDays,
      },
    ],
  };
}
