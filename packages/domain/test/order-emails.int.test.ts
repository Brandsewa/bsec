import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { pino } from "pino";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  adjustInventory,
  applyCartDiscount,
  createAdminDiscount,
  createProduct,
  createRuntime,
  listInventoryLevels,
  placeOrder,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";
import { handleOrderCreatedJob, handleFulfillmentShippedJob } from "../src/jobs.ts";

import type { Transporter } from "nodemailer";
import { setPlatformEmailTransportFactory } from "../src/system/platform-mailer.ts";
import { encryptSecret } from "@bs/payments";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;
let other: TenantContext;
let variantId: string;
let n = 0;

const logger = pino({ level: "silent" });
const sent: Array<Record<string, unknown>> = [];

let slugA: string;

const buyer = (cartToken: string, name = "Asha Rana") => ({
  cartToken,
  idempotencyKey: `idem_${cartToken}`,
  email: "asha@customer.example",
  phone: "9876543210",
  fullName: name,
  addressLine1: "12 Hill Road",
  city: "Dehradun",
  state: "Uttarakhand",
  pincode: "248001",
  paymentMethod: "cod" as const,
});

async function placeOne(code?: string, name?: string) {
  const cart = await getOrCreateCart(rtWeb, ctx, `tok-mail-${++n}`);
  await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: 2 });
  if (code) await applyCartDiscount(rtWeb, ctx, { token: cart.token, code });
  return placeOrder(rtWeb, ctx, buyer(cart.token, name));
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const runId = Math.random().toString(36).slice(2, 7);
  slugA = `mail-a-${runId}`;
  const a = await provisionTenant(rt, { storeName: "Taste of Hills", slug: slugA, owner: { email: `owner@${slugA}.test`, name: "A" }, planCode: "starter", source: "platform_admin" });
  const b = await provisionTenant(rt, { storeName: "Other Shop", slug: `mail-b-${runId}`, owner: { email: `owner@mail-b-${runId}.test`, name: "B" }, planCode: "starter", source: "platform_admin" });
  const mk = (t: { tenantId: string; ownerId: string }): TenantContext => ({
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: ["products.read", "products.write", "orders.read", "orders.write", "discounts.write", "settings.write"],
    requestId: "req-test",
  });
  ctx = mk(a);
  other = mk(b);
  // the store's support address, as set in Settings
  await rt._db.db.update(schema.storeSettings).set({ supportEmail: "help@tasteofhills.example" }).where(eq(schema.storeSettings.tenantId, a.tenantId));
  await createProduct(rtWeb, ctx, { title: "Dalle Timboor Chok Pickle | Powder", status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctx), variants: [{ sku: "MAIL-1", title: "Default", price: 10000 }] });
  const row = (await listInventoryLevels(rtWeb, ctx, {})).items[0]!;
  variantId = row.variantId;
  await adjustInventory(rtWeb, ctx, { variantId, locationId: row.locationId, quantityDelta: 100, reason: "received" });
  await createAdminDiscount(rtWeb, ctx, { code: "TEN", title: "10% off", type: "percent", value: 10 });

  // Seed enabled platform_email_settings
  const enc = encryptSecret("zepto-mail-token-secret");
  await rt._db.db.insert(schema.platformEmailSettings).values({
    id: "default",
    provider: "zoho_zeptomail",
    host: "smtp.zeptomail.in",
    port: 587,
    secureMode: "starttls",
    username: "emailapikey",
    passwordCiphertext: enc.ciphertext,
    passwordIv: enc.iv,
    keyVersion: enc.keyVersion,
    fromEmail: "no-reply@bcom.si",
    fromName: "Brand Sewa",
    enabled: true,
  }).onConflictDoUpdate({
    target: schema.platformEmailSettings.id,
    set: {
      enabled: true,
      passwordCiphertext: enc.ciphertext,
      passwordIv: enc.iv,
    },
  });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

beforeEach(() => {
  sent.length = 0;
  setPlatformEmailTransportFactory((config) => {
    return {
      sendMail: async (mailOpts: Record<string, unknown>) => {
        sent.push({ ...mailOpts, _config: config });
        return { messageId: `msg_${sent.length}` };
      },
    } as unknown as Transporter;
  });
});

afterEach(() => {
  setPlatformEmailTransportFactory(null);
  vi.restoreAllMocks();
});

describe("order confirmation email", () => {
  it("is sent for a placed order with the real order, the discount, the store's name and a working view link", async () => {
    const placed = await placeOne("TEN");
    await handleOrderCreatedJob(rt._db.db, logger, { tenantId: ctx.tenantId, orderId: placed.orderId });

    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe("asha@customer.example");
    expect(mail.subject).toBe(`Order ${placed.orderNumber} confirmed`);
    expect(String(mail.from)).toMatch(/^"?Taste of Hills"? <.+@.+>$/);
    expect(mail.reply_to).toBe("help@tasteofhills.example");

    const text = String(mail.text);
    expect(text).toContain(placed.orderNumber);
    expect(text).toContain("Dalle Timboor Chok Pickle | Powder x 2: ₹200");
    expect(text).toContain("Discount: -₹20"); // 10% of 200
    expect(text).toContain("Shipping: ₹99");
    expect(text).toContain("Total: ₹279");
    expect(text).toContain("Cash on delivery: please pay when your order arrives.");
    expect(text).toContain("Dehradun");

    // the link in the email really opens this order on this store (a fresh token, not the checkout one)
    const link = /View your order: (https:\/\/\S+)/.exec(text)?.[1];
    const linkRegex = new RegExp(`^https://${slugA}\\.bcom\\.si/o/ord_[0-9a-f]{48}$`);
    expect(link).toMatch(linkRegex);
    expect(link).not.toContain(placed.orderToken);
  });

  it("is logged, and a retried job does not send it twice", async () => {
    const placed = await placeOne();
    await handleOrderCreatedJob(rt._db.db, logger, { tenantId: ctx.tenantId, orderId: placed.orderId });
    await handleOrderCreatedJob(rt._db.db, logger, { tenantId: ctx.tenantId, orderId: placed.orderId });
    expect(sent).toHaveLength(1);
    const logs = await rt._db.db.select().from(schema.emailLog).where(eq(schema.emailLog.eventRef, `order_created_${placed.orderId}`));
    expect(logs.map((l) => ({ template: l.template, status: l.status }))).toEqual([{ template: "order_confirmation", status: "sent" }]);
  });

  it("text a shopper typed can't inject markup into the email", async () => {
    const placed = await placeOne(undefined, `<script>alert(1)</script>`);
    await handleOrderCreatedJob(rt._db.db, logger, { tenantId: ctx.tenantId, orderId: placed.orderId });
    const html = String(sent[0]!.html);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("fails (so pg-boss retries) when the order is not visible yet, instead of silently losing the email", async () => {
    await expect(handleOrderCreatedJob(rt._db.db, logger, { tenantId: ctx.tenantId, orderId: "01a0f000-0000-7000-8000-000000000000" })).rejects.toThrow(/not visible yet/);
    expect(sent).toHaveLength(0);
  });

  it("without an email provider configured/enabled the job ends quietly and nothing is sent", async () => {
    await rt._db.db.update(schema.platformEmailSettings).set({ enabled: false }).where(eq(schema.platformEmailSettings.id, "default"));
    try {
      const placed = await placeOne();
      await expect(handleOrderCreatedJob(rt._db.db, logger, { tenantId: ctx.tenantId, orderId: placed.orderId })).resolves.toBeUndefined();
      expect(sent).toHaveLength(0);
    } finally {
      await rt._db.db.update(schema.platformEmailSettings).set({ enabled: true }).where(eq(schema.platformEmailSettings.id, "default"));
    }
  });

  it("another store's order can't be emailed through this store's job", async () => {
    const placed = await placeOne();
    // asking store B to email store A's order finds nothing and must not leak A's data, whichever connection runs the job
    // (the worker uses app_rw; the platform connection bypasses row-level security, so the handler must filter by tenant itself)
    for (const db of [rtWeb._db.db, rt._db.db]) {
      await expect(handleOrderCreatedJob(db, logger, { tenantId: other.tenantId, orderId: placed.orderId })).rejects.toThrow(/not visible yet/);
    }
    expect(sent).toHaveLength(0);
  });
});

describe("shipping email", () => {
  it("names the carrier and tracking number and links to the order", async () => {
    const placed = await placeOne();
    await handleFulfillmentShippedJob(rt._db.db, logger, { tenantId: ctx.tenantId, orderId: placed.orderId, fulfillmentId: "ful-1", awb: "AWB-998877", carrier: "Delhivery" });
    expect(sent).toHaveLength(1);
    const text = String(sent[0]!.text);
    expect(text).toContain("Carrier: Delhivery.");
    expect(text).toContain("Tracking number: AWB-998877.");
    expect(text).toContain(`Track your order: https://${slugA}.bcom.si/o/ord_`);
    expect(String(sent[0]!.subject)).toContain("has shipped");
  });
});
