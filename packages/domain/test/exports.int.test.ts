import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { adjustInventory, createProduct, createRuntime, exportCsv, listInventoryLevels, placeOrder, provisionTenant, csvField, toCsv, type Runtime, type TenantContext } from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let a: TenantContext;
let b: TenantContext;

const mk = (t: { tenantId: string; ownerId: string }, permissions: string[]): TenantContext => ({
  tenantId: t.tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: t.ownerId },
  roles: ["store_owner"],
  permissions,
  requestId: "r",
});
const ALL = ["products.read", "products.write", "orders.read", "orders.write", "customers.read"];

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const ta = await provisionTenant(rt, { storeName: "exp-a", slug: "exp-a", owner: { email: "o@exp-a.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  const tb = await provisionTenant(rt, { storeName: "exp-b", slug: "exp-b", owner: { email: "o@exp-b.test", name: "B" }, planCode: "starter", source: "platform_admin" });
  a = mk(ta, ALL);
  b = mk(tb, ALL);
  await createProduct(rtWeb, a, { title: "=HYPERLINK(\"http://evil\")", status: "active", variants: [{ sku: "E-1", title: "Default", price: 12345 }] });
  await createProduct(rtWeb, b, { title: "Other store secret", status: "active", variants: [{ sku: "B-1", title: "Default", price: 100 }] });
  const row = (await listInventoryLevels(rtWeb, a, {})).items[0]!;
  await adjustInventory(rtWeb, a, { variantId: row.variantId, locationId: row.locationId, quantityDelta: 10, reason: "received" });
  const cart = await getOrCreateCart(rtWeb, a, "tok-exp");
  await addToCart(rtWeb, a, { token: cart.token, variantId: row.variantId, quantity: 1 });
  await placeOrder(rtWeb, a, { cartToken: cart.token, idempotencyKey: "idem-exp", email: "buyer, \"quoted\"@x.example", phone: "9876543210", fullName: "Buyer", addressLine1: "1 St", city: "Pune", state: "Maharashtra", pincode: "411001", paymentMethod: "cod" });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("csv helpers", () => {
  it("quotes commas, quotes and newlines, and defangs spreadsheet formulas", () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField("@cmd")).toBe("'@cmd");
    expect(csvField("-5")).toBe("-5"); // a plain negative number stays a number
    expect(csvField(null)).toBe("");
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("a,b\r\n1,x\r\n");
  });
});

describe("store exports", () => {
  it("products: this store's rows only, prices in rupees, formulas defanged", async () => {
    const { filename, csv } = await exportCsv(rtWeb, a, { kind: "products" });
    expect(filename).toMatch(/^products-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("123.45");
    expect(csv).not.toContain("Other store secret");
  });

  it("orders: the placed order with its money in rupees", async () => {
    const { csv } = await exportCsv(rtWeb, a, { kind: "orders" });
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("Order,Placed at,Status");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"buyer, ""quoted""@x.example"');
    expect(lines[1]).toContain("222.45"); // 123.45 + 99 shipping
  });

  it("another store's export is empty of this store's data", async () => {
    expect((await exportCsv(rtWeb, b, { kind: "orders" })).csv.trim().split("\r\n")).toHaveLength(1);
  });

  it("needs the matching read permission", async () => {
    const limited = { ...a, permissions: ["products.read"] };
    await expect(exportCsv(rtWeb, limited, { kind: "orders" })).rejects.toThrow(/orders\.read|forbidden/i);
    await expect(exportCsv(rtWeb, limited, { kind: "customers" })).rejects.toThrow(/customers\.read|forbidden/i);
  });
});
