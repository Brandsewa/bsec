import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant } from "@bs/db";
import { and, eq } from "drizzle-orm";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import { createRuntime, provisionTenant, type Runtime, type TenantContext } from "../src/index.ts";
import {
  activateHomePage,
  createPage,
  duplicatePage,
  getStorefrontHomePage,
  getStorefrontPage,
  listPages,
  publishPage,
  rollbackPage,
  savePageDraft,
  unpublishPage,
} from "../src/content-services.ts";

/**
 * Homepage versions (Ruttl ticket, 2026-11-20): duplicating the home page makes an unpublished version; "Make active" swaps it
 * with the live home page, so a store can keep several homepages and run one. Real Postgres: the swap touches a unique slug and
 * the RLS-scoped pages table, which a mock would not exercise.
 */
describe("homepage versions (real Postgres)", () => {
  let env: TestDb;
  let rt: Runtime;
  let ctx: TenantContext;
  let foreignCtx: TenantContext;

  const heading = (text: string) => [{ id: crypto.randomUUID(), type: "Heading", version: 1, props: { text, level: "h2" } }];
  const texts = (blocks: unknown[]) => (blocks as Array<{ props: { text?: string } }>).map((b) => b.props.text);
  const homeRows = async () => (await listPages(rt, ctx)).filter((p) => p.type === "home");

  beforeAll(async () => {
    env = await startTestDb();
    const rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
    rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5, revalidateTags: () => {} });
    await seedPlatformStaff(rtPlatform._db.db, { email: `hv-admin-${Date.now()}@platform.test`, role: "platform_admin" });

    const mk = async (name: string) => {
      const t = await provisionTenant(rtPlatform, {
        storeName: name,
        slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
        owner: { email: `${name.toLowerCase().replace(/\s+/g, "")}-${Date.now()}@hv.test`, name: `${name} Owner` },
        planCode: "starter",
        source: "platform_admin",
      });
      const c: TenantContext = {
        tenantId: t.tenantId,
        storeStatus: "live",
        actor: { type: "staff", userId: t.ownerId },
        roles: ["owner", "store_owner"],
        permissions: STORE_PERMISSIONS,
        requestId: `hv-${name}`,
      };
      return c;
    };
    ctx = await mk("Versions Store");
    foreignCtx = await mk("Other Versions Store");

    // A live home page with known content.
    const [home] = await homeRows();
    if (!home) throw new Error("provisioning did not create a home page");
    await savePageDraft(rt, ctx, { id: home.id, blocks: heading("original home") });
    await publishPage(rt, ctx, { id: home.id });
  });

  afterAll(async () => {
    await env?.stop();
  });

  it("duplicating the home page makes an unpublished version and leaves the live home page alone", async () => {
    const [home] = await homeRows();
    const copy = await duplicatePage(rt, ctx, { id: home!.id });

    expect(copy.type).toBe("home_variant");
    expect(copy.status).toBe("draft");
    expect(copy.slug).toBe("home-version-2");
    expect(copy.title).toBe("Home (Version 2)");

    // Not reachable by URL and the live home page is unchanged.
    expect(await getStorefrontPage(rt, ctx, copy.slug)).toBeNull();
    expect((await getStorefrontHomePage(rt, ctx)).document.blocks.length).toBe(1);
    expect(texts((await getStorefrontHomePage(rt, ctx)).document.blocks)).toEqual(["original home"]);
    expect(await homeRows()).toHaveLength(1);

    // The next version gets the next number.
    const second = await duplicatePage(rt, ctx, { id: home!.id });
    expect(second.slug).toBe("home-version-3");
  });

  it("a version cannot be published, restored or unpublished like a normal page", async () => {
    const versions = (await listPages(rt, ctx)).filter((p) => p.type === "home_variant");
    const v = versions[0]!;
    await expect(publishPage(rt, ctx, { id: v.id })).rejects.toThrow(/Make active/);
    await expect(rollbackPage(rt, ctx, { id: v.id, targetVersionId: crypto.randomUUID() })).rejects.toThrow(/Make active/);
    // Unpublishing a draft is a harmless no-op on a version: it is never published.
    await expect(unpublishPage(rt, ctx, { id: v.id })).resolves.toBeDefined();
    expect((await listPages(rt, ctx)).find((p) => p.id === v.id)?.status).toBe("draft");
  });

  it("makes a version the live home page and keeps the old one as a version", async () => {
    const [oldHome] = await homeRows();
    const copy = await duplicatePage(rt, ctx, { id: oldHome!.id });
    await savePageDraft(rt, ctx, { id: copy.id, blocks: heading("new home") });

    const res = await activateHomePage(rt, ctx, { id: copy.id });
    expect(res).toEqual({ success: true, id: copy.id });

    // Exactly one home page, and it is the version we chose, served at the home slot.
    const homes = await homeRows();
    expect(homes).toHaveLength(1);
    expect(homes[0]!.id).toBe(copy.id);
    expect(homes[0]!.slug).toBe("home");
    expect(homes[0]!.status).toBe("published");
    expect(homes[0]!.title).toBe("Home");
    expect(texts((await getStorefrontHomePage(rt, ctx)).document.blocks)).toEqual(["new home"]);

    // The previous home page is now an unpublished version that still holds its content.
    const old = (await listPages(rt, ctx)).find((p) => p.id === oldHome!.id)!;
    expect(old.type).toBe("home_variant");
    expect(old.status).toBe("draft");
    expect(old.slug).toMatch(/^home-version-\d+$/);
    expect(await getStorefrontPage(rt, ctx, old.slug)).toBeNull();

    // It can be made active again: nothing was lost.
    await activateHomePage(rt, ctx, { id: oldHome!.id });
    expect(texts((await getStorefrontHomePage(rt, ctx)).document.blocks)).toEqual(["original home"]);
    expect(await homeRows()).toHaveLength(1);

    // Each switch is audited.
    const audits = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.tenantId, ctx.tenantId), eq(schema.auditLogs.action, "page.home_activated"))),
    );
    expect(audits).toHaveLength(2);
  });

  it("refuses to activate a normal page, and another store cannot activate this store's version", async () => {
    const custom = await createPage(rt, ctx, { title: "About", slug: `about-${Date.now()}` });
    await expect(activateHomePage(rt, ctx, { id: custom.id })).rejects.toThrow(/Only a homepage version/);

    const v = (await listPages(rt, ctx)).find((p) => p.type === "home_variant")!;
    await expect(activateHomePage(rt, foreignCtx, { id: v.id })).rejects.toThrow(/Not Found/);
    expect((await homeRows()).length).toBe(1);
  });

  it("needs the publish permission", async () => {
    const v = (await listPages(rt, ctx)).find((p) => p.type === "home_variant")!;
    const noPublish: TenantContext = { ...ctx, permissions: STORE_PERMISSIONS.filter((p) => p !== "theme.publish") };
    await expect(activateHomePage(rt, noPublish, { id: v.id })).rejects.toThrow();
  });
});
