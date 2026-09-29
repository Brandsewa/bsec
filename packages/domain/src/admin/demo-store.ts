import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { STORE_PERMISSIONS } from "@bs/auth";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { grantStoreOwner } from "./create-owner.ts";
import { purgeTenantData } from "./tenant-purge.ts";
import { updateStoreSettings } from "./store-config.ts";
import { createProduct, createCategory, createCollection, adjustInventory, getProduct } from "../catalog-services.ts";
import { createPage, publishPage, savePageDraft, createMenu } from "../content-services.ts";
import { createAdminDiscount } from "./discounts.ts";
import { createAdminFulfillment } from "./orders.ts";
import { generateInvoice } from "../orders/invoices.ts";
import { placeOrder } from "../orders/checkout.ts";
import { transitionOrder } from "../orders/state-machine.ts";
import { transitionFulfillment } from "../orders/fulfillment-state-machine.ts";
import { transitionReturn } from "../orders/return-state-machine.ts";
import { addToCart, getOrCreateCart } from "../storefront/cart.ts";

export const DEMO_SLUG = "demo-store";
const DEMO_EMAIL_DOMAIN = "demo.example";

export interface SeedDemoInput {
  /** An existing staff login that becomes the owner of the demo store. */
  ownerEmail: string;
}

export interface SeedDemoResult {
  tenantId: string;
  slug: string;
  alreadySeeded: boolean;
  products: number;
  customers: number;
  orders: number;
  discounts: number;
}

interface DemoVariant {
  id: string;
  price: number;
  stock: number;
}

const CATEGORIES = ["Apparel", "Home & Kitchen", "Accessories"] as const;

const PRODUCTS: Array<{
  title: string;
  category: (typeof CATEGORIES)[number];
  status: "active" | "draft" | "archived";
  variants: Array<{ title: string; price: number; stock: number }>;
}> = [
  { title: "Cotton Kurta", category: "Apparel", status: "active", variants: [{ title: "S", price: 149900, stock: 25 }, { title: "M", price: 149900, stock: 30 }, { title: "L", price: 149900, stock: 18 }] },
  { title: "Block Print Dupatta", category: "Apparel", status: "active", variants: [{ title: "Free size", price: 89900, stock: 40 }] },
  { title: "Handloom Saree", category: "Apparel", status: "active", variants: [{ title: "Free size", price: 349900, stock: 12 }] },
  { title: "Linen Shirt", category: "Apparel", status: "active", variants: [{ title: "M", price: 119900, stock: 3 }, { title: "L", price: 119900, stock: 0 }] },
  { title: "Ceramic Chai Cups (Set of 4)", category: "Home & Kitchen", status: "active", variants: [{ title: "Default", price: 69900, stock: 50 }] },
  { title: "Brass Diya", category: "Home & Kitchen", status: "active", variants: [{ title: "Default", price: 24900, stock: 100 }] },
  { title: "Jute Storage Basket", category: "Home & Kitchen", status: "active", variants: [{ title: "Default", price: 49900, stock: 0 }] },
  { title: "Leather Wallet", category: "Accessories", status: "active", variants: [{ title: "Tan", price: 79900, stock: 35 }, { title: "Black", price: 79900, stock: 28 }] },
  { title: "Silk Scarf", category: "Accessories", status: "draft", variants: [{ title: "Default", price: 59900, stock: 20 }] },
  { title: "Old Season Tote", category: "Accessories", status: "archived", variants: [{ title: "Default", price: 39900, stock: 5 }] },
];

const CUSTOMERS = [
  { name: "Aarav Sharma", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
  { name: "Priya Nair", city: "Kochi", state: "Kerala", pincode: "682001" },
  { name: "Rohan Mehta", city: "Mumbai", state: "Maharashtra", pincode: "400001" },
  { name: "Ananya Iyer", city: "Chennai", state: "Tamil Nadu", pincode: "600001" },
  { name: "Vikram Singh", city: "Jaipur", state: "Rajasthan", pincode: "302001" },
  { name: "Sneha Reddy", city: "Hyderabad", state: "Telangana", pincode: "500001" },
  { name: "Kabir Khan", city: "Delhi", state: "Delhi", pincode: "110001" },
  { name: "Meera Das", city: "Kolkata", state: "West Bengal", pincode: "700001" },
];

function demoCtx(tenantId: string): TenantContext {
  return {
    tenantId,
    storeStatus: "live",
    actor: { type: "system" },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: `demo_${randomUUID()}`,
  };
}

/**
 * Creates (or refills) a separate Demo Store for trying every admin screen with realistic data, through the
 * real domain services and state machines. Nothing here touches any other store, calls any external
 * provider, or sends any email. Idempotent: a store that already has demo products is left alone.
 */
export async function seedDemoStore(rt: Runtime, input: SeedDemoInput): Promise<SeedDemoResult> {
  const db = rt._db.db;
  const slug = DEMO_SLUG; // never a caller-chosen store: seeding writes data into the tenant
  const ownerEmail = input.ownerEmail.trim().toLowerCase();

  const [owner] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, ownerEmail)).limit(1);
  if (!owner) throw new Error(`No login exists for ${ownerEmail}. Create the owner login first (create-owner).`);

  let [tenant] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1);
  if (!tenant) {
    const [org] = await db.insert(schema.organizations).values({ name: "Demo Organization" }).returning({ id: schema.organizations.id });
    if (!org) throw new Error("Could not create organization");
    [tenant] = await db
      .insert(schema.tenants)
      .values({ slug, name: "Demo Store", organizationId: org.id, status: "active", currency: "INR", timezone: "Asia/Kolkata" })
      .returning({ id: schema.tenants.id });
  } else {
    await db.update(schema.tenants).set({ status: "active", archivedAt: null }).where(eq(schema.tenants.id, tenant.id));
  }
  if (!tenant) throw new Error("Could not create demo store");
  const tenantId = tenant.id;
  const ctx = demoCtx(tenantId);

  await grantStoreOwner(db, tenantId, owner.id);

  const existing = await db.execute<{ n: number }>(sql`select count(*)::int as n from products where tenant_id = ${tenantId}`);
  if ((existing.rows[0]?.n ?? 0) > 0) {
    return { tenantId, slug, alreadySeeded: true, products: existing.rows[0]?.n ?? 0, customers: 0, orders: 0, discounts: 0 };
  }

  await updateStoreSettings(rt, ctx, {
    storeName: "Demo Store",
    legalName: "Demo Traders Private Limited",
    supportEmail: `support@${DEMO_EMAIL_DOMAIN}`,
    supportPhone: "+919800000000",
    address: { line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
    tax: { gstin: "29ABCDE1234F1Z5", sellerState: "Karnataka", pricesIncludeTax: true },
  });

  const [location] = await db
    .insert(schema.locations)
    .values({ tenantId, name: "Main Warehouse", isDefault: true })
    .returning({ id: schema.locations.id });
  if (!location) throw new Error("Could not create location");

  // Catalog
  const categoryIds = new Map<string, string>();
  for (const name of CATEGORIES) {
    const c = await createCategory(rt, ctx, { name });
    categoryIds.set(name, c.id);
  }
  await createCollection(rt, ctx, { title: "Bestsellers" });

  const variantsByProduct: DemoVariant[][] = [];
  for (const p of PRODUCTS) {
    const created = await createProduct(rt, ctx, {
      title: p.title,
      status: p.status,
      tags: ["demo"],
      variants: p.variants.map((v, i) => ({ sku: `DEMO-${p.title.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase()}-${i + 1}`, title: v.title, price: v.price })),
    });
    const detail = await getProduct(rt, ctx, { id: created.id });
    const vs: DemoVariant[] = [];
    for (const [i, v] of detail.variants.entries()) {
      const stock = p.variants[i]?.stock ?? 0;
      vs.push({ id: v.id, price: v.price, stock });
      if (stock > 0) {
        await adjustInventory(rt, ctx, { variantId: v.id, locationId: location.id, quantityDelta: stock, reason: "received", notes: "Demo opening stock" });
      }
    }
    variantsByProduct.push(vs);
  }

  // Marketing
  const discountDefs = [
    { code: "DEMOWELCOME10", title: "Welcome 10% off", type: "percent" as const, value: 10 },
    { code: "DEMOFLAT200", title: "Flat ₹200 off", type: "fixed" as const, value: 20000 },
    { code: "DEMOFREESHIP", title: "Free shipping", type: "free_shipping" as const, value: 0 },
  ];
  for (const d of discountDefs) await createAdminDiscount(rt, ctx, d);

  const about = await createPage(rt, ctx, { title: "About us", slug: "demo-about-us", description: "Our story" });
  await savePageDraft(rt, ctx, {
    id: about.id,
    blocks: [
      {
        id: "demo-about-1",
        type: "RichText",
        version: 1,
        props: { content: "<h2>About Demo Store</h2><p>This page is sample content created by the demo tool.</p>", alignment: "left" },
      },
    ],
  });
  await publishPage(rt, ctx, { id: about.id });
  const lookbook = await createPage(rt, ctx, { title: "Diwali lookbook (draft)", slug: "demo-diwali-lookbook" });
  await savePageDraft(rt, ctx, {
    id: lookbook.id,
    blocks: [
      {
        id: "demo-lookbook-1",
        type: "RichText",
        version: 1,
        props: { content: "<h2>Festive collection</h2><p>Coming soon.</p>", alignment: "center" },
      },
    ],
  });
  await createMenu(rt, ctx, {
    name: "Header",
    handle: "demo-header",
    items: [{ label: "Shop all", url: "/products" }, { label: "About us", url: "/demo-about-us" }],
  });

  // Customers
  const customerIds: string[] = [];
  for (const [i, c] of CUSTOMERS.entries()) {
    const email = `${c.name.toLowerCase().replace(/[^a-z]+/g, ".")}@${DEMO_EMAIL_DOMAIN}`;
    const [row] = await db
      .insert(schema.customers)
      .values({ tenantId, email, phone: `98000000${String(10 + i).padStart(2, "0")}`, name: c.name, phoneVerified: true, acceptsMarketing: i % 2 === 0 })
      .returning({ id: schema.customers.id });
    if (row) customerIds.push(row.id);
  }

  // Orders through the real checkout and state machines
  const activeProducts = variantsByProduct.filter((_, i) => PRODUCTS[i]?.status === "active");
  // Orders only use well-stocked variants so the deliberately out-of-stock and low-stock ones stay that way.
  const sellable = activeProducts.map((vs) => vs.find((v) => v.stock >= 20)).filter((v): v is DemoVariant => Boolean(v));
  let orderSeq = 0;
  const spend = new Map<string, { total: number; orders: number }>();

  async function newOrder(customerIndex: number) {
    orderSeq += 1;
    const customer = CUSTOMERS[customerIndex % CUSTOMERS.length] ?? CUSTOMERS[0];
    if (!customer) throw new Error("No demo customers");
    const customerId = customerIds[customerIndex % customerIds.length];
    const cart = await getOrCreateCart(rt, ctx, `demo_cart_${orderSeq}`);
    const picks = [sellable[orderSeq % sellable.length], sellable[(orderSeq + 3) % sellable.length]].filter((v): v is DemoVariant => Boolean(v));
    for (const [i, v] of [...new Set(picks)].entries()) {
      await addToCart(rt, ctx, { token: cart.token, variantId: v.id, quantity: i === 0 ? 1 + (orderSeq % 2) : 1 });
    }
    const placed = await placeOrder(rt, ctx, {
      cartToken: cart.token,
      idempotencyKey: `demo_order_${orderSeq}`,
      email: `${customer.name.toLowerCase().replace(/[^a-z]+/g, ".")}@${DEMO_EMAIL_DOMAIN}`,
      phone: `98000000${String(10 + (customerIndex % CUSTOMERS.length)).padStart(2, "0")}`,
      fullName: customer.name,
      addressLine1: `${10 + orderSeq} Demo Street`,
      city: customer.city,
      state: customer.state,
      pincode: customer.pincode,
      paymentMethod: "cod",
    });
    if (customerId) {
      await db.update(schema.orders).set({ customerId }).where(eq(schema.orders.id, placed.orderId));
      const prev = spend.get(customerId) ?? { total: 0, orders: 0 };
      spend.set(customerId, { total: prev.total + placed.grandTotal, orders: prev.orders + 1 });
    }
    return placed;
  }

  async function codIntentFor(orderId: string): Promise<string | undefined> {
    const [intent] = await db
      .select({ id: schema.paymentIntents.id })
      .from(schema.paymentIntents)
      .where(and(eq(schema.paymentIntents.tenantId, tenantId), eq(schema.paymentIntents.orderId, orderId)))
      .limit(1);
    return intent?.id;
  }

  async function confirm(orderId: string) {
    await transitionOrder(rt, ctx, orderId, { type: "order.confirm", reason: "Demo: customer confirmed" });
  }
  async function ship(orderId: string, upTo: "label" | "transit" | "delivered" | "rto") {
    await transitionOrder(rt, ctx, orderId, { type: "order.process" });
    const f = await createAdminFulfillment(rt, ctx, { id: orderId, carrier: "Demo Courier", awb: `DEMOAWB${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}` });
    const fid = (f as { id?: string; fulfillmentId?: string }).id ?? (f as { fulfillmentId?: string }).fulfillmentId;
    if (!fid) throw new Error("Fulfillment id missing");
    if (upTo === "label") return fid;
    await transitionFulfillment(rt, ctx, fid, { type: "fulfillment.pick_up" });
    await transitionFulfillment(rt, ctx, fid, { type: "fulfillment.transit", location: "Regional hub", message: "Arrived at hub" });
    await transitionOrder(rt, ctx, orderId, { type: "order.partially_fulfill" });
    await transitionOrder(rt, ctx, orderId, { type: "order.fulfill" });
    if (upTo === "transit") return fid;
    if (upTo === "rto") {
      await transitionFulfillment(rt, ctx, fid, { type: "fulfillment.rto", reason: "Customer unreachable" });
      const intentId = await codIntentFor(orderId);
      if (intentId) await transitionOrder(rt, ctx, orderId, { type: "payment.cod_fail", intentId, reason: "Refused at the door" });
      return fid;
    }
    await transitionFulfillment(rt, ctx, fid, { type: "fulfillment.out_for_delivery" });
    await transitionFulfillment(rt, ctx, fid, { type: "fulfillment.deliver" });
    await transitionOrder(rt, ctx, orderId, { type: "order.deliver" });
    const intentId = await codIntentFor(orderId);
    if (intentId) await transitionOrder(rt, ctx, orderId, { type: "payment.cod_collect", intentId });
    return fid;
  }

  const plan: Array<[number, string]> = [
    [0, "pending"], [1, "pending"], [2, "pending"], [3, "pending"],
    [4, "confirmed"], [5, "confirmed"], [6, "confirmed"],
    [7, "label"], [0, "label"],
    [1, "transit"], [2, "transit"], [3, "transit"],
    [4, "delivered"], [5, "delivered"], [6, "delivered"], [7, "delivered"],
    [0, "rto"],
    [1, "cancelled"],
    [2, "return"],
  ];

  let returnedOrder: { orderId: string } | undefined;
  for (const [customerIndex, stage] of plan) {
    const placed = await newOrder(customerIndex);
    if (stage === "pending") continue;
    if (stage === "cancelled") {
      await transitionOrder(rt, ctx, placed.orderId, { type: "order.cancel", reason: "Demo: customer changed their mind" });
      continue;
    }
    await confirm(placed.orderId);
    if (stage === "confirmed") continue;
    if (stage === "label") {
      await ship(placed.orderId, "label");
      continue;
    }
    if (stage === "transit" || stage === "rto") {
      await ship(placed.orderId, stage);
      continue;
    }
    await ship(placed.orderId, "delivered");
    await generateInvoice(rt, ctx, { orderId: placed.orderId });
    if (stage === "return") returnedOrder = { orderId: placed.orderId };
  }

  if (returnedOrder) {
    const [orderRow] = await db.select({ number: schema.orders.number }).from(schema.orders).where(eq(schema.orders.id, returnedOrder.orderId)).limit(1);
    const [ret] = await db
      .insert(schema.returns)
      .values({ tenantId, orderId: returnedOrder.orderId, number: `RET-${orderRow?.number ?? "DEMO"}`, reason: "Size did not fit", resolution: "refund" })
      .returning({ id: schema.returns.id });
    if (ret) {
      const items = await db
        .select({ id: schema.orderItems.id, quantity: schema.orderItems.quantity })
        .from(schema.orderItems)
        .where(and(eq(schema.orderItems.tenantId, tenantId), eq(schema.orderItems.orderId, returnedOrder.orderId)))
        .limit(1);
      for (const it of items) {
        await db.insert(schema.returnItems).values({ tenantId, returnId: ret.id, orderItemId: it.id, quantity: 1 });
      }
      await transitionReturn(rt, ctx, ret.id, { type: "return.approve", adminNote: "Demo: approved" });
    }
  }

  for (const [customerId, s] of spend) {
    await db
      .update(schema.customers)
      .set({ ordersCount: s.orders, totalSpent: s.total, lastOrderAt: new Date() })
      .where(eq(schema.customers.id, customerId));
  }

  return { tenantId, slug, alreadySeeded: false, products: PRODUCTS.length, customers: CUSTOMERS.length, orders: orderSeq, discounts: discountDefs.length };
}

/** Removes everything in the demo store (data, logins' memberships) and archives the empty shell. */
export async function removeDemoStore(rt: Runtime, slug = DEMO_SLUG): Promise<{ removed: boolean; deleted: Record<string, number> }> {
  const db = rt._db.db;
  const [tenant] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1);
  if (!tenant) return { removed: false, deleted: {} };
  if (slug !== DEMO_SLUG) throw new Error("Refusing to remove a store other than the demo store");
  const { deleted } = await purgeTenantData(db, tenant.id);
  await db.update(schema.tenants).set({ status: "archived", archivedAt: new Date() }).where(eq(schema.tenants.id, tenant.id));
  return { removed: true, deleted };
}
