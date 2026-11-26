import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { schema, withTenant } from "@bs/db";
import {
  createProduct,
  createRuntime,
  createVariant,
  deleteVariant,
  provisionTenant,
  setProductOptions,
  updateVariant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
/** The web runtime connects as app_rw, so Row Level Security applies exactly as in production. */
let rtRls: Runtime;
let ctx: TenantContext;
let otherCtx: TenantContext;

const ctxFor = (tenantId: string, ownerId: string): TenantContext => ({
  tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: ownerId },
  roles: ["store_owner"],
  permissions: ["products.read", "products.write"],
  requestId: "req_variant_builder_test",
});

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtRls = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 3 });
  const a = await provisionTenant(rt, { storeName: "vb-a", slug: "vb-a", owner: { email: "owner-vb-a@test.com", name: "Owner A" }, planCode: "starter", source: "platform_admin" });
  const b = await provisionTenant(rt, { storeName: "vb-b", slug: "vb-b", owner: { email: "owner-vb-b@test.com", name: "Owner B" }, planCode: "starter", source: "platform_admin" });
  ctx = ctxFor(a.tenantId, a.ownerId);
  otherCtx = ctxFor(b.tenantId, b.ownerId);
}, 180_000);

afterAll(async () => {
  await rtRls?.close();
  await rt?.close();
  await env?.stop();
});

async function makeProduct(title: string, price = 50_000) {
  return createProduct(rt, ctx, { title, variants: [{ sku: `${title.toUpperCase().replace(/\W+/g, "-")}-1`, title: "Default Variant", price }] });
}

describe("variant builder", () => {
  it("turns a one-variant product into an option grid, keeping that variant's price and SKU", async () => {
    const p = await makeProduct("Grid Tea");
    const original = p.variants[0]!;

    const detail = await setProductOptions(rt, ctx, {
      productId: p.id,
      options: [
        { name: "Size", values: ["50g", "100g"] },
        { name: "Pack", values: ["Pouch", "Tin"] },
      ],
    });
    expect(detail.options.map((o) => o.name)).toEqual(["Size", "Pack"]);
    expect(detail.variants).toHaveLength(4);

    const adopted = detail.variants.find((v) => v.id === original.id)!;
    expect(adopted.sku).toBe(original.sku);
    expect(adopted.price).toBe(50_000);
    expect(adopted.optionValues).toEqual({ Size: "50g", Pack: "Pouch" });
    expect(adopted.title).toBe("50g / Pouch");

    const skus = detail.variants.map((v) => v.sku.toLowerCase());
    expect(new Set(skus).size).toBe(4); // generated SKUs never collide
    for (const v of detail.variants.filter((x) => x.id !== original.id)) expect(v.price).toBe(50_000);
  });

  it("keeps existing variants when options grow, and never deletes variants outside the grid", async () => {
    const p = await makeProduct("Grow Tea");
    const first = await setProductOptions(rt, ctx, { productId: p.id, options: [{ name: "Size", values: ["S", "M"] }], defaultPriceMinor: 70_000 });
    expect(first.variants).toHaveLength(2);
    const s = first.variants.find((v) => v.optionValues?.["Size"] === "S")!;
    await updateVariant(rt, ctx, { id: s.id, price: 99_900, weightGrams: 250, barcode: "8901234567890", dimensions: { lengthCm: 10, widthCm: 8, heightCm: 5 } });

    // add a value and an option: matching variants keep their edits, new ones get the default price
    const grown = await setProductOptions(rt, ctx, { productId: p.id, options: [{ name: "Size", values: ["S", "M", "L"] }], defaultPriceMinor: 80_000 });
    expect(grown.variants).toHaveLength(3);
    const sAfter = grown.variants.find((v) => v.id === s.id)!;
    expect(sAfter.price).toBe(99_900);
    expect(sAfter.weightGrams).toBe(250);
    expect(sAfter.barcode).toBe("8901234567890");
    expect(sAfter.dimensions).toEqual({ lengthCm: 10, widthCm: 8, heightCm: 5 });
    expect(grown.variants.find((v) => v.optionValues?.["Size"] === "L")!.price).toBe(80_000);

    // shrinking the grid keeps the now-unmatched variant (nothing is deleted behind the owner's back)
    const shrunk = await setProductOptions(rt, ctx, { productId: p.id, options: [{ name: "Size", values: ["S"] }] });
    expect(shrunk.variants).toHaveLength(3);
  });

  it("adding a second option extends the existing variants instead of leaving them behind", async () => {
    // Owner report 2026-11-26: Colour then Size left "Red" and "Blue" outside the grid next to new "Red / S"... variants,
    // and the storefront then showed one combined list instead of a Colour picker and a Size picker.
    const p = await makeProduct("Two Axis Tee");
    const colour = await setProductOptions(rt, ctx, { productId: p.id, options: [{ name: "Colour", values: ["Red", "Blue"] }] });
    const red = colour.variants.find((v) => v.optionValues?.["Colour"] === "Red")!;
    const blue = colour.variants.find((v) => v.optionValues?.["Colour"] === "Blue")!;
    await updateVariant(rt, ctx, { id: blue.id, price: 61_000 });

    const both = await setProductOptions(rt, ctx, {
      productId: p.id,
      options: [
        { name: "Colour", values: ["Red", "Blue"] },
        { name: "Size", values: ["S", "M"] },
      ],
    });
    expect(both.variants).toHaveLength(4);
    for (const v of both.variants) {
      expect(Object.keys(v.optionValues ?? {}).sort()).toEqual(["Colour", "Size"]);
    }
    const redAfter = both.variants.find((v) => v.id === red.id)!;
    expect(redAfter.optionValues).toEqual({ Colour: "Red", Size: "S" });
    expect(redAfter.title).toBe("Red / S");
    expect(redAfter.sku).toBe(red.sku);
    const blueAfter = both.variants.find((v) => v.id === blue.id)!;
    expect(blueAfter.optionValues).toEqual({ Colour: "Blue", Size: "S" });
    expect(blueAfter.price).toBe(61_000);
  });

  it("refuses invalid option sets", async () => {
    const p = await makeProduct("Limit Tea");
    await expect(
      setProductOptions(rt, ctx, { productId: p.id, options: [1, 2, 3, 4].map((n) => ({ name: `O${n}`, values: ["a"] })) }),
    ).rejects.toThrow(/at most 3 options/);
    await expect(
      setProductOptions(rt, ctx, {
        productId: p.id,
        options: [
          { name: "A", values: Array.from({ length: 30 }, (_, i) => `a${i}`) },
          { name: "B", values: Array.from({ length: 9 }, (_, i) => `b${i}` ) },
        ],
      }),
    ).rejects.toThrow(/at most 250/);
  });

  it("creates and deletes single variants with the safety rules", async () => {
    const p = await makeProduct("Single Tea");
    const extra = await createVariant(rt, ctx, { productId: p.id, sku: "SINGLE-EXTRA", title: "Extra", price: 12_300, weightGrams: 120, barcode: " 123 " });
    expect(extra.barcode).toBe("123");
    expect(extra.weightGrams).toBe(120);
    await expect(createVariant(rt, ctx, { productId: p.id, sku: "SINGLE-EXTRA", title: "Dup", price: 1 })).rejects.toThrow(/already used/);

    await expect(deleteVariant(rt, ctx, { id: extra.id })).resolves.toEqual({ success: true });

    // A variant sitting in a shopper's open cart can still be deleted; the cart line goes with it.
    const carted = await createVariant(rt, ctx, { productId: p.id, sku: "SINGLE-CARTED", title: "Carted", price: 5_000 });
    const cartId = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
      const [cart] = await tx.insert(schema.carts).values({ tenantId: ctx.tenantId, token: `vb-cart-${carted.id}` }).returning();
      await tx.insert(schema.cartItems).values({ tenantId: ctx.tenantId, cartId: cart!.id, variantId: carted.id, quantity: 1, unitPriceSnapshot: 5_000 });
      return cart!.id;
    });
    await expect(deleteVariant(rtRls, ctx, { id: carted.id })).resolves.toEqual({ success: true });
    const lines = await withTenant(rt._db.db, ctx.tenantId, (tx) => tx.select().from(schema.cartItems).where(eq(schema.cartItems.cartId, cartId)));
    expect(lines).toHaveLength(0);

    const [only] = (await makeProduct("Only Tea")).variants;
    await expect(deleteVariant(rt, ctx, { id: only!.id })).rejects.toThrow(/at least one variant/);
  });

  it("is tenant scoped: another store cannot touch the product or its variants", async () => {
    const p = await makeProduct("Private Tea");
    for (const runtime of [rt, rtRls]) {
      await expect(setProductOptions(runtime, otherCtx, { productId: p.id, options: [{ name: "Size", values: ["S"] }] })).rejects.toThrow(/not found/i);
      await expect(createVariant(runtime, otherCtx, { productId: p.id, sku: "X-1", title: "X", price: 1 })).rejects.toThrow(/not found/i);
      await expect(deleteVariant(runtime, otherCtx, { id: p.variants[0]!.id })).rejects.toThrow(/not found/i);
    }
  });

  it("requires the products.write permission", async () => {
    const p = await makeProduct("Perm Tea");
    const readOnly = { ...ctx, permissions: ["products.read"] };
    await expect(setProductOptions(rt, readOnly, { productId: p.id, options: [{ name: "Size", values: ["S"] }] })).rejects.toThrow(/permission|forbidden/i);
  });
});
