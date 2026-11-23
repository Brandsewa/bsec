/**
 * Integration: a product's long description is stored as validated blocks or plain text, whichever way it arrives (the admin
 * editor sends blocks; a spreadsheet import sends text), and is read back the same.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client as PgClient } from "pg";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { createProduct, createRuntime, provisionTenant, updateProduct, type Runtime, type TenantContext } from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;
let pg: PgClient;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const t = await provisionTenant(rt, { storeName: "Desc Store", slug: "desc-store", owner: { email: "o@desc.test", name: "O" }, planCode: "growth", source: "platform_admin" });
  ctx = { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: "req-desc" } as TenantContext;
  const PG = (await import("pg")).default;
  pg = new PG.Client({ connectionString: env.superUrl });
  await pg.connect();
}, 240_000);

afterAll(async () => {
  await pg?.end();
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

const stored = async (id: string) => ((await pg.query(`select description_json from products where id = $1`, [id])).rows[0] as { description_json: unknown }).description_json;
const make = (title: string, descriptionJson?: unknown) =>
  createProduct(rtWeb, ctx, { title, status: "draft", variants: [{ sku: `D-${Math.random().toString(36).slice(2, 8)}`, title: "Default", price: 1000 }], ...(descriptionJson !== undefined ? { descriptionJson } : {}) } as never);

describe("product long descriptions", () => {
  it("stores formatted blocks from the editor, and plain text as plain text", async () => {
    const rich = await make("Rich Tea", { v: 1, blocks: [{ type: "heading", level: 2, text: "Notes" }, { type: "paragraph", text: "Floral and bright." }] });
    expect(await stored(rich.id)).toMatchObject({ v: 1, blocks: [{ type: "heading" }, { type: "paragraph" }] });
    const plain = await make("Plain Tea", { type: "text", text: "Just one paragraph." });
    expect(await stored(plain.id)).toEqual({ type: "text", text: "Just one paragraph." });
  });

  it("turns structured text (a spreadsheet import with paragraphs and a list) into blocks", async () => {
    const p = await make("Import Tea", { type: "text", text: "# Brewing\nUse fresh water.\n\n- 85 degrees\n- 3 minutes" });
    expect(await stored(p.id)).toMatchObject({ v: 1, blocks: [{ type: "heading", text: "Brewing" }, { type: "paragraph" }, { type: "list", items: ["85 degrees", "3 minutes"] }] });
  });

  it("updates between the two forms, clears with empty content, and refuses an unsafe link", async () => {
    const p = await make("Switch Tea", { type: "text", text: "Old text." });
    await updateProduct(rtWeb, ctx, { id: p.id, descriptionJson: { v: 1, blocks: [{ type: "paragraph", text: "New formatted text." }] } } as never);
    expect(await stored(p.id)).toMatchObject({ v: 1 });
    await expect(
      updateProduct(rtWeb, ctx, { id: p.id, descriptionJson: { v: 1, blocks: [{ type: "paragraph", text: "Hi", marks: [{ type: "link", start: 0, end: 2, href: "javascript:alert(1)" }] }] } } as never),
    ).rejects.toThrow(/Bad Request/);
    expect(await stored(p.id)).toMatchObject({ v: 1 });
    await updateProduct(rtWeb, ctx, { id: p.id, descriptionJson: { type: "text", text: "   " } } as never);
    expect(await stored(p.id)).toBeNull();
  });
});
