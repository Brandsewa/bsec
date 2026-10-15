import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { STORE_PERMISSIONS } from "@bs/auth";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { createProduct, createCategory, createCollection, adjustInventory, getProduct, type CreateProductInput } from "../catalog-services.ts";
import { updateAdminShippingSettings } from "../orders/shipping-rates.ts";
import { DEMO_SLUG } from "./demo-store.ts";

/**
 * Catalog fixture for testing the theme page set (docs/THEME-TEMPLATES-PLAN.md section 6): collections and
 * products that cover every storefront case (variants, sale prices, sold out, low stock, draft, archived).
 * Local/ephemeral databases only. It only ever writes to the "demo-store" tenant, through the real domain
 * services. Idempotent: a store that already has products tagged `theme-demo` is left alone.
 */
export const THEME_DEMO_TAG = "theme-demo";

interface DemoProduct {
  title: string;
  status?: "active" | "draft" | "archived";
  collections: string[];
  shortDescription?: string;
  options?: Array<{ name: string; values: string[] }>;
  /** `opt` maps option name to value. `stock` omitted means 0. */
  variants: Array<{ opt?: Record<string, string>; title: string; price: number; compareAt?: number; stock?: number }>;
}

const COLLECTIONS = [
  { title: "Men", slug: "men" },
  { title: "Women", slug: "women" },
  { title: "Accessories", slug: "accessories" },
  { title: "New Arrivals", slug: "new-arrivals" },
  { title: "Sale", slug: "sale" },
  { title: "Empty Collection", slug: "empty-collection" },
] as const;

const SIZES = ["S", "M", "L", "XL"];
const COLORS = ["Black", "Olive", "Sand"];

function sizeColor(price: number, compareAt?: number, soldOutKey?: string): DemoProduct["variants"] {
  const out: DemoProduct["variants"] = [];
  for (const color of COLORS) {
    for (const size of SIZES) {
      const key = `${size}/${color}`;
      out.push({
        opt: { Size: size, Color: color },
        title: key,
        price: color === "Sand" ? price + 20000 : price, // variant-specific price
        ...(compareAt ? { compareAt } : {}),
        stock: key === soldOutKey ? 0 : 12,
      });
    }
  }
  return out;
}

const PRODUCTS: DemoProduct[] = [
  // Simple, single SKU
  { title: "Brass Diya", collections: ["accessories"], variants: [{ title: "Default", price: 24900, stock: 100 }] },
  { title: "Ceramic Chai Cups (Set of 4)", collections: ["accessories", "new-arrivals"], variants: [{ title: "Default", price: 69900, stock: 50 }] },
  // One option
  {
    title: "Cotton Kurta",
    collections: ["men", "new-arrivals"],
    options: [{ name: "Size", values: SIZES }],
    variants: SIZES.map((s) => ({ opt: { Size: s }, title: s, price: 149900, stock: s === "XL" ? 0 : 20 })),
  },
  {
    title: "Linen Shirt",
    collections: ["men"],
    options: [{ name: "Size", values: SIZES }],
    variants: SIZES.map((s) => ({ opt: { Size: s }, title: s, price: 119900, stock: s === "M" ? 3 : s === "L" ? 0 : 15 })),
  },
  {
    title: "Leather Wallet",
    collections: ["men", "accessories"],
    options: [{ name: "Colour", values: ["Tan", "Black"] }],
    variants: [
      { opt: { Colour: "Tan" }, title: "Tan", price: 79900, stock: 35 },
      { opt: { Colour: "Black" }, title: "Black", price: 79900, stock: 28 },
    ],
  },
  // Two options (Size x Color) with variant-specific price
  {
    title: "Everyday Hoodie",
    collections: ["men", "women", "new-arrivals"],
    options: [{ name: "Size", values: SIZES }, { name: "Color", values: COLORS }],
    variants: sizeColor(249900, undefined, "S/Black"),
  },
  // Sale (compare-at)
  {
    title: "Handloom Saree",
    collections: ["women", "sale"],
    variants: [{ title: "Free size", price: 249900, compareAt: 349900, stock: 12 }],
  },
  {
    title: "Block Print Dupatta",
    collections: ["women", "sale"],
    variants: [{ title: "Free size", price: 59900, compareAt: 89900, stock: 40 }],
  },
  {
    title: "Weekender Jacket",
    collections: ["women", "men", "sale"],
    options: [{ name: "Size", values: SIZES }, { name: "Color", values: COLORS }],
    variants: sizeColor(299900, 399900),
  },
  // Three options (stress the selector)
  {
    title: "Trail Backpack",
    collections: ["accessories"],
    options: [{ name: "Size", values: ["20L", "30L"] }, { name: "Color", values: ["Black", "Olive"] }, { name: "Material", values: ["Canvas", "Nylon"] }],
    variants: ["20L", "30L"].flatMap((size) =>
      ["Black", "Olive"].flatMap((color) =>
        ["Canvas", "Nylon"].map((material) => ({
          opt: { Size: size, Color: color, Material: material },
          title: `${size}/${color}/${material}`,
          price: material === "Nylon" ? 189900 : 159900,
          stock: 8,
        })),
      ),
    ),
  },
  // Fully sold out
  { title: "Jute Storage Basket", collections: ["accessories"], variants: [{ title: "Default", price: 49900, stock: 0 }] },
  // Long title, long description
  {
    title: "Hand-Embroidered Chikankari Anarkali Suit Set With Dupatta And Matching Palazzo Trousers In Pastel Shades",
    collections: ["women", "new-arrivals"],
    shortDescription: "A very long product title and description used to check wrapping on cards, the product page and the cart. ".repeat(6).trim(),
    variants: [{ title: "Default", price: 459900, stock: 5 }],
  },
  // Must never appear on the storefront
  { title: "Silk Scarf (draft)", status: "draft", collections: ["accessories"], variants: [{ title: "Default", price: 59900, stock: 20 }] },
  { title: "Old Season Tote (archived)", status: "archived", collections: ["accessories"], variants: [{ title: "Default", price: 39900, stock: 5 }] },
];

function ctxFor(tenantId: string): TenantContext {
  return {
    tenantId,
    storeStatus: "live",
    actor: { type: "system" },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: `theme_demo_${randomUUID()}`,
  };
}

export interface ThemeDemoCatalogResult {
  tenantId: string;
  alreadySeeded: boolean;
  collections: number;
  products: number;
}

export async function seedThemeDemoCatalog(rt: Runtime): Promise<ThemeDemoCatalogResult> {
  const db = rt._db.db;
  const [tenant] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, DEMO_SLUG)).limit(1);
  if (!tenant) throw new Error("Demo store not found. Run the demo seed first (node dist/demo.js seed).");
  const tenantId = tenant.id;
  const ctx = ctxFor(tenantId);

  // The store's own shipping rates (never hardcoded in code, plan rule 12): Rs 50 standard, free from Rs 2,999. Safe to repeat.
  await updateAdminShippingSettings(rt, ctx, { zoneName: "Domestic (India)", standardRatePaise: 5000, expressRatePaise: 15000, freeShippingThresholdPaise: 299900 });

  const existing = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from products where tenant_id = ${tenantId} and ${THEME_DEMO_TAG} = any(tags)`,
  );
  if ((existing.rows[0]?.n ?? 0) > 0) return { tenantId, alreadySeeded: true, collections: 0, products: existing.rows[0]?.n ?? 0 };

  let [location] = await db.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.tenantId, tenantId)).limit(1);
  if (!location) {
    [location] = await db.insert(schema.locations).values({ tenantId, name: "Main Warehouse", isDefault: true }).returning({ id: schema.locations.id });
  }
  if (!location) throw new Error("Could not find or create a stock location");

  // Active products need a primary category; reuse rows left by an interrupted earlier run so a rerun can finish the job.
  const categoryIds = new Map<string, string>();
  for (const name of ["Men", "Women", "Accessories"]) {
    const [found] = await db.select({ id: schema.categories.id }).from(schema.categories).where(and(eq(schema.categories.tenantId, tenantId), eq(schema.categories.name, name))).limit(1);
    categoryIds.set(name, found?.id ?? (await createCategory(rt, ctx, { name })).id);
  }

  const collectionIds = new Map<string, string>();
  for (const c of COLLECTIONS) {
    const slug = `${THEME_DEMO_TAG}-${c.slug}`;
    const [found] = await db.select({ id: schema.collections.id }).from(schema.collections).where(and(eq(schema.collections.tenantId, tenantId), eq(schema.collections.slug, slug))).limit(1);
    collectionIds.set(c.slug, found?.id ?? (await createCollection(rt, ctx, { title: c.title, slug, published: true })).id);
  }

  for (const p of PRODUCTS) {
    const prefix = p.title.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase();
    const input: CreateProductInput = {
      title: p.title,
      // distinct from the base demo store products, which share some titles
      slug: `td-${p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60)}`,
      status: p.status ?? "active",
      tags: [THEME_DEMO_TAG],
      primaryCategoryId: categoryIds.get(p.collections.includes("women") ? "Women" : p.collections.includes("men") ? "Men" : "Accessories"),
      collectionIds: p.collections.map((s) => collectionIds.get(s)).filter((id): id is string => Boolean(id)),
      ...(p.shortDescription ? { shortDescription: p.shortDescription } : {}),
      ...(p.options ? { options: p.options } : {}),
      variants: p.variants.map((v, i) => ({
        sku: `TD-${prefix}-${i + 1}`,
        title: v.title,
        price: v.price,
        ...(v.compareAt ? { compareAtPrice: v.compareAt } : {}),
        ...(v.opt ? { optionValues: v.opt } : {}),
      })),
    };
    const created = await createProduct(rt, ctx, input);
    const detail = await getProduct(rt, ctx, { id: created.id });
    for (const [i, v] of detail.variants.entries()) {
      const stock = p.variants[i]?.stock ?? 0;
      if (stock > 0) {
        await adjustInventory(rt, ctx, { variantId: v.id, locationId: location.id, quantityDelta: stock, reason: "received", notes: "Theme demo opening stock" });
      }
    }
  }

  return { tenantId, alreadySeeded: false, collections: COLLECTIONS.length, products: PRODUCTS.length };
}
