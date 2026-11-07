import { and, eq, sql, inArray } from "drizzle-orm";
import { DIRECT_PRODUCT_STATUSES } from "./product-status.ts";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { cartWeightGrams, getTenantShippingRates } from "../orders/shipping-rates.ts";
import { toCountryCode } from "../orders/shipping-rules.ts";
import { publicMediaUrl } from "../media/storage.ts";
import { evaluateCartDiscounts } from "../orders/discounts.ts";
import { MAX_CODES_PER_CART } from "../discounts/engine.ts";
import { postalCodeProblem } from "../markets/addresses.ts";
import { isNonBaseMarket, isProductVisibleInMarket, loadCheckoutMarket, loadMarketPriceMap } from "../markets/lookup.ts";
import { loadStatePriceMap } from "../apps/state-pricing.ts";

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
    preorderEnabled?: boolean | undefined;
    preorderShipsOn?: string | null | undefined;
    preorderMessage?: string | null | undefined;
  };
  primaryImage: {
    mediaId: string;
    alt: string | null;
    url?: string | undefined;
  } | null;
  createdAt: string;
  updatedAt: string;
}

/** The shopper behind a cart, for discounts made for some customers. `strict` is set at checkout, when a guest who matches no customer is a stranger. */
export interface Shopper {
  customerId?: string | null | undefined;
  strict?: boolean | undefined;
}

/** A discount code that is on the cart and still valid for it. */
export interface CartDiscount {
  discountId: string;
  code: string;
  title: string;
  type: string;
  /** Goods discount in paise (0 for free shipping). */
  amount: number;
  freeShipping: boolean;
  /** True when it applied by itself (no code typed). */
  automatic: boolean;
  /** "product" discounts touch only some lines; "order" ones the whole order; "shipping" the delivery charge. */
  discountClass: "product" | "order" | "shipping";
  /** For free shipping: waive at most this much of the shipping charge. */
  maxShipping?: number | null | undefined;
  /** The generated single-use code that was typed, so it can be marked used when the order is placed. */
  bulkCodeId?: string | undefined;
  /** For a product discount: what it takes off each cart line (cart item id to amount). */
  lineAmounts?: Record<string, number> | undefined;
}

export interface StorefrontCart {
  id: string;
  token: string;
  currency: string;
  /** The market the cart is priced in (ADR-040). null on carts created before markets existed (treated as the base market). */
  marketId?: string | null | undefined;
  /** State Pricing app (ADR-044): the state this cart is priced for. */
  priceRegion?: string | null | undefined;
  items: StorefrontCartItem[];
  itemCount: number;
  subtotal: number;
  /** The main applied discount (a typed code wins over an automatic one), if any. Kept for screens that show one line. */
  discount?: CartDiscount | null | undefined;
  /** Every discount applied to the cart: the typed code and/or automatic ones (ADR-045). */
  discounts?: CartDiscount[] | undefined;
  /** The nearest automatic offer more spending would unlock ("Add 200.00 more to get 15% off"), worked out on the server. */
  discountNudge?: { remaining: number; threshold: number; benefit: string } | null | undefined;
  /** Typed codes the engine turned down, with the reason (used when a shopper tries a code). */
  discountRejections?: Array<{ code: string; reason: string }> | undefined;
  /** Set when a code that was applied is no longer valid (expired, minimum no longer met...): the shopper must remove or fix it. */
  discountNotice?: string | null | undefined;
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
  /** Shipping state, when known, to pick the matching shipping zone. */
  state?: string | undefined;
  /** ISO country of the destination; defaults to the cart's market (India for the base market). */
  country?: string | undefined;
}

/**
 * Loads a full cart with its line items joined with variant, product, and primary media.
 */
async function loadCartWithItems(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  cartRecord: typeof schema.carts.$inferSelect,
  /** Who is shopping, when the caller knows better than the cart does (checkout resolves the customer from their details). */
  shopper?: Shopper,
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
        compareAtPrice: schema.variants.compareAtPrice,
        preorderEnabled: schema.variants.preorderEnabled,
        preorderShipsOn: schema.variants.preorderShipsOn,
        preorderMessage: schema.variants.preorderMessage,
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
      primaryStorageKey: schema.media.storageKey,
      mediaAlt: schema.media.alt,
      mediaKind: schema.media.kind,
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
    .leftJoin(schema.media, eq(schema.media.id, schema.productMedia.mediaId))
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
        preorderEnabled: r.variant.preorderEnabled,
        preorderShipsOn: r.variant.preorderShipsOn ? (typeof r.variant.preorderShipsOn === "string" ? r.variant.preorderShipsOn : (r.variant.preorderShipsOn as Date).toISOString().slice(0, 10)) : null,
        preorderMessage: r.variant.preorderMessage,
      },
      primaryImage: r.primaryMedia?.mediaId
        ? {
            mediaId: r.primaryMedia.mediaId,
            alt: r.primaryMedia.alt || r.mediaAlt || r.product.title,
            kind: (r.mediaKind as "image" | "video" | "document") ?? "image",
            url: publicMediaUrl(r.primaryStorageKey),
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

  // The engine runs on every read (ADR-045): a typed code that expires or whose minimum is no longer met never silently
  // stays applied, and automatic discounts appear without the shopper doing anything.
  const typedCodes = cartRecord.discountCodes ?? [];
  const evaluated = await evaluateCartDiscounts(tx as unknown as Db, cartRecord.tenantId as string, {
    codes: typedCodes,
    lines: items.map((it, i) => ({
      id: it.id,
      productId: it.product.id,
      quantity: it.quantity,
      unitPrice: it.unitPriceSnapshot,
      lineTotal: it.lineTotal,
      // A compare-at price above the selling price marks a sale item (base prices; market prices follow the same ratio).
      onSale: rawItems[i]?.variant.compareAtPrice != null && Number(rawItems[i]?.variant.compareAtPrice) > Number(rawItems[i]?.variant.price),
    })),
    cartSubtotal: subtotal,
    cartTotalQty: itemCount,
    currency: cartRecord.currency ?? "INR",
    marketId: cartRecord.marketId ?? null,
    customerId: shopper?.customerId ?? cartRecord.customerId ?? null,
    strict: shopper?.strict === true,
  });
  const discounts: CartDiscount[] = evaluated.applications.map((a) => ({
    discountId: a.discountId,
    code: a.code ?? a.title,
    title: a.title,
    type: a.type,
    amount: a.amount,
    freeShipping: a.freeShipping,
    automatic: a.automatic,
    discountClass: a.discountClass,
    ...(a.bulkCodeId ? { bulkCodeId: a.bulkCodeId } : {}),
    ...(a.freeShipping ? { maxShipping: a.maxShipping ?? null } : {}),
    ...(a.lineAmounts ? { lineAmounts: a.lineAmounts } : {}),
  }));
  const discount: CartDiscount | null = discounts.find((d) => !d.automatic) ?? discounts[0] ?? null;
  // A typed code that stopped working is reported by name (a code typed just now and refused is reported by apply instead).
  const stale = evaluated.rejections.find((r) => typedCodes.some((c) => c.toUpperCase() === r.code));
  const discountNotice: string | null = stale ? `Code ${stale.code} can't be used: ${stale.reason}` : null;

  return {
    id: cartRecord.id,
    token: cartRecord.token,
    currency: cartRecord.currency,
    marketId: cartRecord.marketId ?? null,
    priceRegion: cartRecord.priceRegion ?? null,
    items,
    itemCount,
    subtotal,
    discount,
    discounts,
    discountRejections: evaluated.rejections,
    discountNudge: evaluated.nudge,
    discountNotice,
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
 * Moves a cart to another market (ADR-040): the cart's currency changes, every line is repriced from the new market's
 * prices, and a line that market does not sell (no price, or hidden from its catalog) is removed.
 */
async function repriceCartToMarket(
  tx: Db,
  tenantId: string,
  cart: typeof schema.carts.$inferSelect,
  marketId: string,
): Promise<typeof schema.carts.$inferSelect> {
  const market = await loadCheckoutMarket(tx, tenantId, marketId);
  const items = await tx
    .select({ id: schema.cartItems.id, variantId: schema.cartItems.variantId, productId: schema.variants.productId, basePrice: schema.variants.price })
    .from(schema.cartItems)
    .innerJoin(schema.variants, and(eq(schema.variants.tenantId, schema.cartItems.tenantId), eq(schema.variants.id, schema.cartItems.variantId)))
    .where(eq(schema.cartItems.cartId, cart.id));
  const prices = await loadMarketPriceMap(tx, tenantId, market.id, items.map((i) => i.variantId));
  for (const it of items) {
    const visible = await isProductVisibleInMarket(tx, tenantId, market.id, it.productId);
    const price = market.isBase ? Number(it.basePrice) : prices.get(it.variantId)?.price;
    if (!visible || price === undefined || price <= 0) {
      await tx.delete(schema.cartItems).where(eq(schema.cartItems.id, it.id));
    } else {
      await tx.update(schema.cartItems).set({ unitPriceSnapshot: price, updatedAt: new Date() }).where(eq(schema.cartItems.id, it.id));
    }
  }
  const [updated] = await tx
    .update(schema.carts)
    .set({ currency: market.currency, marketId: market.id, lastActivityAt: new Date() })
    .where(eq(schema.carts.id, cart.id))
    .returning();
  return updated ?? cart;
}

/**
 * State Pricing app (ADR-044): stamps the cart with the shopper's state and reprices every line from the variant's
 * default price or its price in that state. A null region puts the cart back on default prices. Base market only.
 */
async function repriceCartToRegion(
  tx: Db,
  tenantId: string,
  cart: typeof schema.carts.$inferSelect,
  region: string | null,
): Promise<typeof schema.carts.$inferSelect> {
  const items = await tx
    .select({ id: schema.cartItems.id, variantId: schema.cartItems.variantId, basePrice: schema.variants.price })
    .from(schema.cartItems)
    .innerJoin(schema.variants, and(eq(schema.variants.tenantId, schema.cartItems.tenantId), eq(schema.variants.id, schema.cartItems.variantId)))
    .where(eq(schema.cartItems.cartId, cart.id));
  const statePrices = region ? await loadStatePriceMap(tx, tenantId, region, items.map((i) => i.variantId)) : new Map<string, { price: number; compareAtPrice: number | null }>();
  for (const it of items) {
    const price = statePrices.get(it.variantId)?.price ?? Number(it.basePrice);
    await tx.update(schema.cartItems).set({ unitPriceSnapshot: price, updatedAt: new Date() }).where(eq(schema.cartItems.id, it.id));
  }
  const [updated] = await tx.update(schema.carts).set({ priceRegion: region, lastActivityAt: new Date() }).where(eq(schema.carts.id, cart.id)).returning();
  return updated ?? cart;
}

/**
 * Looks up active cart by token and tenantId. If not found, generates a new UUID token and creates a cart row.
 */
export async function getOrCreateCart(
  rt: Runtime,
  ctx: TenantContext,
  token?: string,
  txOrDb?: Parameters<Parameters<typeof withTenant>[2]>[0],
  /** The market the shopper is in (ADR-040). Omitted = keep the cart's own market, or the base market for a new cart. */
  marketId?: string | null,
  /** Who is shopping, for discounts made for some customers. Omitted = the cart's own customer. */
  shopper?: Shopper,
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
      const market = await loadCheckoutMarket(tx as unknown as Db, ctx.tenantId, marketId);
      const newToken = crypto.randomUUID();
      const [newCart] = await tx
        .insert(schema.carts)
        .values({
          token: newToken,
          tenantId: ctx.tenantId,
          currency: market.currency,
          marketId: market.id,
          priceRegion: ctx.priceRegion && !(await isNonBaseMarket(tx as unknown as Db, ctx.tenantId, market.id)) ? ctx.priceRegion : null,
          status: "active",
        })
        .returning();

      if (!newCart) {
        throw new Error("Failed to create cart");
      }
      cartRecord = newCart;
    } else if (marketId && cartRecord.marketId !== marketId) {
      // The shopper switched market: the cart keeps its items but is repriced in the new market's currency.
      cartRecord = await repriceCartToMarket(tx as unknown as Db, ctx.tenantId, cartRecord, marketId);
    }
    // The cart follows the shopper's state (ADR-044). undefined = the caller does not use the app, leave the cart alone.
    if (ctx.priceRegion !== undefined && (ctx.priceRegion ?? null) !== (cartRecord.priceRegion ?? null) && !(await isNonBaseMarket(tx as unknown as Db, ctx.tenantId, cartRecord.marketId ?? null))) {
      cartRecord = await repriceCartToRegion(tx as unknown as Db, ctx.tenantId, cartRecord, ctx.priceRegion ?? null);
    }

    return loadCartWithItems(tx, cartRecord, shopper);
  };

  if (txOrDb) {
    return runWithTx(txOrDb);
  }

  const db = rt._db.db;
  return withTenant(db, ctx.tenantId, runWithTx);
}

async function assertNotMaintenance(tx: Parameters<Parameters<typeof withTenant>[2]>[0], ctx: TenantContext): Promise<void> {
  if (ctx.storeStatus === "maintenance" && ctx.actor.type !== "staff") {
    const err = new Error("Store is currently undergoing scheduled maintenance");
    (err as unknown as { status: number }).status = 503;
    throw err;
  }
  const [stRow] = await tx
    .select({
      mode: schema.storeStatus.mode,
      allowStaffPreview: schema.storeStatus.maintenanceAllowStaffPreview,
    })
    .from(schema.storeStatus)
    .where(eq(schema.storeStatus.tenantId, ctx.tenantId))
    .limit(1);

  if (stRow?.mode === "maintenance") {
    const isStaffPreview = ctx.actor.type === "staff" && (stRow.allowStaffPreview ?? true);
    if (!isStaffPreview) {
      const err = new Error("Store is currently undergoing scheduled maintenance");
      (err as unknown as { status: number }).status = 503;
      throw err;
    }
  }
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
    await assertNotMaintenance(tx, ctx);

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
          inArray(schema.products.status, [...DIRECT_PRODUCT_STATUSES]),
          sql`${schema.products.deletedAt} IS NULL`,
        ),
      )
      .limit(1);

    const variantData = variantRows[0];
    if (!variantData) {
      throw new Error("Variant not found or product is not available");
    }

    if (variantData.product.priceOnRequest) {
      throw new Error("This product is price on request and cannot be added to cart");
    }

    const cartMarketId = cartRecord.marketId ?? null;
    if (!(await isProductVisibleInMarket(tx as unknown as Db, ctx.tenantId, cartMarketId, variantData.product.id))) {
      throw new Error("Variant not found or product is not available");
    }
    let unitPriceSnapshot = Number(variantData.variant.price);
    if (await isNonBaseMarket(tx as unknown as Db, ctx.tenantId, cartMarketId)) {
      const prices = await loadMarketPriceMap(tx as unknown as Db, ctx.tenantId, cartMarketId, [input.variantId]);
      const marketPrice = prices.get(input.variantId);
      if (!marketPrice || marketPrice.price <= 0) throw new Error("This product is not available in your region");
      unitPriceSnapshot = marketPrice.price;
    } else if (cartRecord.priceRegion) {
      const sp = (await loadStatePriceMap(tx as unknown as Db, ctx.tenantId, cartRecord.priceRegion, [input.variantId])).get(input.variantId);
      if (sp) unitPriceSnapshot = sp.price;
    }

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
    await assertNotMaintenance(tx, ctx);
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
    await assertNotMaintenance(tx, ctx);
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
    await assertNotMaintenance(tx, ctx);
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
 * The shipping options for a cart going to a given state (and country), priced by the same function the order is
 * charged with. Used by checkout to refresh the options when the shopper picks a state. No pincode is needed.
 */
export async function quoteCartShipping(
  rt: Runtime,
  ctx: TenantContext,
  input: { token: string; state: string; country?: string | undefined },
): Promise<ShippingEstimate["rates"]> {
  const cart = await getOrCreateCart(rt, ctx, input.token);
  const weightGrams = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
    cartWeightGrams(tx, cart.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity }))),
  );
  // The cart's market decides which zones apply and which country is assumed when none is given (ADR-040).
  const market = await withTenant(rt._db.db, ctx.tenantId, (tx) => loadCheckoutMarket(tx, ctx.tenantId, cart.marketId));
  const country = toCountryCode(input.country) ?? (market.isBase ? "IN" : (market.countries[0] ?? "IN"));
  const rates = await getTenantShippingRates(rt._db.db, ctx.tenantId, cart.subtotal, {
    weightGrams,
    destination: { country, state: input.state },
    ...(market.id ? { market: { id: market.id, isBase: market.isBase } } : {}),
  });
  return rates.map((r) => ({
    id: r.method,
    title: r.title,
    description: r.description,
    amount: r.amount,
    estimatedDays: r.estimatedDays,
  }));
}

/**
 * Validates Indian pincode format and computes shipping rates based on cart subtotal.
 */
export async function estimateCartShipping(
  rt: Runtime,
  ctx: TenantContext,
  input: EstimateCartShippingInput,
): Promise<ShippingEstimate> {
  const cart = await getOrCreateCart(rt, ctx, input.token);
  const market = await withTenant(rt._db.db, ctx.tenantId, (tx) => loadCheckoutMarket(tx, ctx.tenantId, cart.marketId));
  const country = toCountryCode(input.country) ?? (market.isBase ? "IN" : (market.countries[0] ?? "IN"));
  if (country === "IN") {
    if (!/^[1-9][0-9]{5}$/.test(input.pincode)) throw new Error("Invalid Indian pincode format");
  } else if (postalCodeProblem(country, input.pincode)) {
    throw new Error("Invalid postal code format");
  }

  const weightGrams = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
    cartWeightGrams(tx, cart.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity }))),
  );
  const rates = await getTenantShippingRates(rt._db.db, ctx.tenantId, cart.subtotal, {
    weightGrams,
    // Without a state or country the store's default zone is used, as before markets (a non-base market always names its country).
    ...(input.state || input.country || !market.isBase ? { destination: { country, ...(input.state ? { state: input.state } : {}) } } : {}),
    ...(market.id ? { market: { id: market.id, isBase: market.isBase } } : {}),
  });

  return {
    serviceable: true,
    pincode: input.pincode,
    rates: rates.map((r) => ({
      id: r.method,
      title: r.title,
      description: r.description,
      amount: r.amount,
      estimatedDays: r.estimatedDays,
    })),
  };
}

/**
 * Puts a discount code on the cart. Codes stack when the rules allow (up to ${MAX_CODES_PER_CART}); a code that cannot sit
 * beside the ones already there replaces them if it works on its own. The engine says whether it applies and why not.
 * With `allowEmpty` (a shared link) the code is kept for later on a cart that has nothing in it yet.
 */
export async function applyCartDiscount(rt: Runtime, ctx: TenantContext, input: { token: string; code: string; allowEmpty?: boolean | undefined }): Promise<StorefrontCart> {
  const code = input.code.trim();
  if (!code) throw new Error("Bad Request: enter a discount code");
  if (code.length > 64) throw new Error("Bad Request: that discount code is too long");
  const wanted = code.toUpperCase();

  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [cartRecord] = await tx.select().from(schema.carts).where(eq(schema.carts.token, input.token)).limit(1);
    if (!cartRecord) throw new Error("Not Found: cart not found");

    const current = await loadCartWithItems(tx, { ...cartRecord, discountCodes: [] });
    const empty = current.items.length === 0;
    if (empty && !input.allowEmpty) throw new Error("Bad Request: add something to your cart first");

    const existing = cartRecord.discountCodes ?? [];
    const together = [...existing.filter((c) => c.toUpperCase() !== wanted), code];
    if (together.length > MAX_CODES_PER_CART) throw new Error(`Bad Request: you can use up to ${MAX_CODES_PER_CART} codes on one order`);

    const appliedIn = (c: StorefrontCart) => c.discounts?.find((d) => !d.automatic && d.code.toUpperCase() === wanted);
    let trial = await loadCartWithItems(tx, { ...cartRecord, discountCodes: together });
    if (!appliedIn(trial) && !empty && existing.length > 0) {
      const alone = await loadCartWithItems(tx, { ...cartRecord, discountCodes: [code] });
      if (appliedIn(alone)) {
        trial = alone;
      }
    }
    if (!appliedIn(trial)) {
      const why = trial.discountRejections?.find((r) => r.code === wanted);
      // A shared link can arrive before anything is in the cart: keep a code that exists, it is checked once there is something to check.
      if (!(empty && why && why.reason !== "Discount code not found")) throw new Error(`Bad Request: ${why?.reason ?? "this code can't be used"}`);
    }

    // Store the codes as the engine knows them (upper case), dropping any that no longer apply.
    const stored = empty ? [wanted] : (trial.discounts ?? []).filter((d) => !d.automatic).map((d) => d.code);
    const [updated] = await tx
      .update(schema.carts)
      .set({ discountCodes: stored, lastActivityAt: new Date() })
      .where(eq(schema.carts.id, cartRecord.id))
      .returning();
    return loadCartWithItems(tx, updated ?? cartRecord);
  });
}

/** Takes a discount code off the cart: the one named, or all of them when none is. */
export async function removeCartDiscount(rt: Runtime, ctx: TenantContext, input: { token: string; code?: string | undefined }): Promise<StorefrontCart> {
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [cartRecord] = await tx.select().from(schema.carts).where(eq(schema.carts.token, input.token)).limit(1);
    if (!cartRecord) throw new Error("Not Found: cart not found");
    const left = input.code ? (cartRecord.discountCodes ?? []).filter((c) => c.toUpperCase() !== input.code?.trim().toUpperCase()) : [];
    const [updated] = await tx
      .update(schema.carts)
      .set({ discountCodes: left, lastActivityAt: new Date() })
      .where(eq(schema.carts.id, cartRecord.id))
      .returning();
    return loadCartWithItems(tx, updated ?? cartRecord);
  });
}
