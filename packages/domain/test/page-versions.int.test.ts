import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant } from "@bs/db";
import { and, eq } from "drizzle-orm";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import { createRuntime, provisionTenant, type Runtime, type TenantContext } from "../src/index.ts";
import { createPage, getPage, getPageVersion, listPageVersions, publishPage, rollbackPage, savePageDraft } from "../src/content-services.ts";

/**
 * Page version history (docs/PAGE-VERSION-HISTORY-PLAN.md): read a version, restore it safely, record who saved it.
 * Pattern: real Postgres (startTestDb); mocks would prove nothing about RLS or the page check.
 */
describe("page version history (real Postgres)", () => {
  let env: TestDb;
  let rt: Runtime;
  let ctx: TenantContext;
  let foreignCtx: TenantContext;
  let ownerId: string;

  const heading = (text: string) => [{ id: crypto.randomUUID(), type: "Heading", version: 1, props: { text, level: "h2" } }];

  beforeAll(async () => {
    env = await startTestDb();
    const rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
    rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5, revalidateTags: () => {} });
    await seedPlatformStaff(rtPlatform._db.db, { email: `vh-admin-${Date.now()}@platform.test`, role: "platform_admin" });

    const mk = async (name: string) => {
      const t = await provisionTenant(rtPlatform, {
        storeName: name,
        slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
        owner: { email: `${name.toLowerCase().replace(/\s+/g, "")}-${Date.now()}@vh.test`, name: `${name} Owner` },
        planCode: "starter",
        source: "platform_admin",
      });
      const c: TenantContext = {
        tenantId: t.tenantId,
        storeStatus: "live",
        actor: { type: "staff", userId: t.ownerId },
        roles: ["owner", "store_owner"],
        permissions: STORE_PERMISSIONS,
        requestId: `vh-${name}`,
      };
      return { t, c };
    };
    const a = await mk("History Store");
    const b = await mk("Other Store");
    ctx = a.c;
    ownerId = a.t.ownerId;
    foreignCtx = b.c;
  });

  afterAll(async () => {
    await env?.stop();
  });

  it("records who saved a version and lists it with a block count, newest first", async () => {
    const page = await createPage(rt, ctx, { title: "Authors", slug: `authors-${Date.now()}` });
    await savePageDraft(rt, ctx, { id: page.id, blocks: heading("one") });
    const second = await savePageDraft(rt, ctx, { id: page.id, blocks: [...heading("two"), ...heading("three")] });

    const list = await listPageVersions(rt, ctx, { id: page.id });
    expect(list[0]?.id).toBe(second.versionId);
    expect(list[0]?.blockCount).toBe(2);
    expect(list[0]?.createdBy).toBeTruthy();
    expect(list[0]?.isDraft).toBe(true);

    const authorRow = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
      tx.select({ createdBy: schema.pageVersions.createdBy }).from(schema.pageVersions).where(eq(schema.pageVersions.id, second.versionId)),
    );
    expect(authorRow[0]?.createdBy).toBe(ownerId);
  });

  it("pages through the list with limit and before", async () => {
    const page = await createPage(rt, ctx, { title: "Paging", slug: `paging-${Date.now()}` });
    for (const n of ["a", "b", "c"]) {
      await savePageDraft(rt, ctx, { id: page.id, blocks: heading(n) });
      await new Promise((r) => setTimeout(r, 5));
    }
    const first = await listPageVersions(rt, ctx, { id: page.id, limit: 2 });
    expect(first).toHaveLength(2);
    const rest = await listPageVersions(rt, ctx, { id: page.id, limit: 2, before: first[1]!.createdAt });
    expect(rest.length).toBeGreaterThanOrEqual(1);
    expect(rest.some((v) => first.some((f) => f.id === v.id))).toBe(false);
    await expect(listPageVersions(rt, ctx, { id: page.id, before: "not-a-date" })).rejects.toThrow(/invalid cursor/);
  });

  it("reads one version's blocks, and refuses another page's or another store's version", async () => {
    const pageA = await createPage(rt, ctx, { title: "Read A", slug: `read-a-${Date.now()}` });
    const pageB = await createPage(rt, ctx, { title: "Read B", slug: `read-b-${Date.now()}` });
    const vA = await savePageDraft(rt, ctx, { id: pageA.id, blocks: heading("page a") });
    const vB = await savePageDraft(rt, ctx, { id: pageB.id, blocks: heading("page b") });

    const read = await getPageVersion(rt, ctx, { id: pageA.id, versionId: vA.versionId });
    expect(read.blocks).toHaveLength(1);
    expect(JSON.stringify(read.blocks)).toContain("page a");

    await expect(getPageVersion(rt, ctx, { id: pageA.id, versionId: vB.versionId })).rejects.toThrow(/Not Found/);
    await expect(getPageVersion(rt, foreignCtx, { id: pageA.id, versionId: vA.versionId })).rejects.toThrow(/Not Found/);
  });

  it("restores as a new live version, keeps the old row, and writes an audit log", async () => {
    const page = await createPage(rt, ctx, { title: "Restore", slug: `restore-${Date.now()}` });
    const v1 = await savePageDraft(rt, ctx, { id: page.id, blocks: heading("original") });
    await publishPage(rt, ctx, { id: page.id, versionId: v1.versionId });
    const v2 = await savePageDraft(rt, ctx, { id: page.id, blocks: heading("overwritten") });
    await publishPage(rt, ctx, { id: page.id, versionId: v2.versionId });

    const result = await rollbackPage(rt, ctx, { id: page.id, targetVersionId: v1.versionId });
    expect(result.publishedVersionId).not.toBe(v1.versionId);
    expect(result.publishedVersionId).not.toBe(v2.versionId);

    const live = await getPage(rt, ctx, { id: page.id });
    expect(JSON.stringify(live.blocks)).toContain("original");
    expect(live.publishedVersionId).toBe(result.publishedVersionId);

    const list = await listPageVersions(rt, ctx, { id: page.id });
    expect(list.find((v) => v.id === v1.versionId)).toBeDefined();
    expect(list[0]?.id).toBe(result.publishedVersionId);
    expect(list[0]?.note).toMatch(/^Restored from /);
    expect(list[0]?.isPublished).toBe(true);

    // Undo: restoring the overwritten version brings it back as another new version.
    const undo = await rollbackPage(rt, ctx, { id: page.id, targetVersionId: v2.versionId });
    expect(JSON.stringify((await getPage(rt, ctx, { id: page.id })).blocks)).toContain("overwritten");
    expect(undo.publishedVersionId).not.toBe(result.publishedVersionId);

    const audits = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, "page.restored"), eq(schema.auditLogs.targetId, page.id))),
    );
    expect(audits).toHaveLength(2);
  });

  it("refuses to restore a version that belongs to another page or another store", async () => {
    const home = await createPage(rt, ctx, { title: "Target", slug: `target-${Date.now()}` });
    const header = await createPage(rt, ctx, { title: "Source", slug: `source-${Date.now()}` });
    const homeV = await savePageDraft(rt, ctx, { id: home.id, blocks: heading("home content") });
    await publishPage(rt, ctx, { id: home.id, versionId: homeV.versionId });
    const headerV = await savePageDraft(rt, ctx, { id: header.id, blocks: heading("header content") });

    // The incident this prevents: pointing one page at another page's blocks.
    await expect(rollbackPage(rt, ctx, { id: home.id, targetVersionId: headerV.versionId })).rejects.toThrow(/Not Found/);
    const stillHome = await getPage(rt, ctx, { id: home.id });
    expect(JSON.stringify(stillHome.blocks)).toContain("home content");

    await expect(rollbackPage(rt, foreignCtx, { id: home.id, targetVersionId: homeV.versionId })).rejects.toThrow();
  });

  it("needs the publish permission to restore, but only write permission to read history", async () => {
    const page = await createPage(rt, ctx, { title: "Perms", slug: `perms-${Date.now()}` });
    const v = await savePageDraft(rt, ctx, { id: page.id, blocks: heading("x") });
    const writer: TenantContext = { ...ctx, permissions: STORE_PERMISSIONS.filter((p) => p !== "theme.publish") };
    await expect(listPageVersions(rt, writer, { id: page.id })).resolves.toBeDefined();
    await expect(getPageVersion(rt, writer, { id: page.id, versionId: v.versionId })).resolves.toBeDefined();
    await expect(rollbackPage(rt, writer, { id: page.id, targetVersionId: v.versionId })).rejects.toThrow(/Forbidden|permission/i);
  });
});
