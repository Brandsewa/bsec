import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Client as PgClient } from "pg";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { runMigrations } from "@bs/db/migrate";
import { validateBlockDocument, type BlockInstance } from "@bs/blocks";
import {
  LAUNCH_TEMPLATE_CODE,
  LAUNCH_TEMPLATE_HOME,
  LAUNCH_TEMPLATE_TOKENS,
  activateTheme,
  createRuntime,
  createThemeTemplate,
  getPage,
  getStorefrontHomePage,
  listPageVersions,
  listThemeLibrary,
  listThemeTemplates,
  publishPage,
  publishThemeTemplate,
  resolveBlockData,
  savePageDraft,
  saveThemeTemplateDraft,
  updateThemeTemplateMeta,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let web: Runtime; // app_rw: what the storefront and store admin run as
let platform: Runtime; // app_platform: what the super admin API runs as
let pg: PgClient;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

const ORG = "0199a0a4-0000-7000-8000-000000000000";
const TENANT_A = "0199a0a4-0000-7000-8000-00000000000a";
const TENANT_B = "0199a0a4-0000-7000-8000-00000000000b";
// Platform staff are seeded in beforeAll with the shared fixture (verified MFA, fresh session).
let OWNER_STAFF = "";
let SUPPORT_STAFF = "";

const ctxFor = (tenantId: string): TenantContext => ({
  tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: OWNER_STAFF },
  roles: ["store_admin"],
  permissions: ["content.write", "theme.publish"],
  requestId: "req_themes_test",
});
const storefrontCtx = (tenantId: string): TenantContext => ({
  tenantId,
  storeStatus: "live",
  actor: { type: "anonymous" },
  roles: [],
  permissions: [],
  requestId: "req_storefront",
});

const rows = async <T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> =>
  (await pg.query(q, params)).rows as T[];

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 5 });
  web = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 5 });
  platform = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 5 });

  pg = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pg.connect();
  await pg.query(`
    INSERT INTO organizations (id, name) VALUES ('${ORG}', 'Themes Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES
      ('${TENANT_A}', '${ORG}', 'themes-a', 'Store A'),
      ('${TENANT_B}', '${ORG}', 'themes-b', 'Store B') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${TENANT_A}', false);
    INSERT INTO products (tenant_id, title, slug, status, is_featured) VALUES
      ('${TENANT_A}', 'Featured Jar', 'featured-jar', 'active', true),
      ('${TENANT_A}', 'Plain Jar', 'plain-jar', 'active', false),
      ('${TENANT_A}', 'Draft Jar', 'draft-jar', 'draft', true) ON CONFLICT DO NOTHING;
  `);
  OWNER_STAFF = (await seedPlatformStaff(platform._db.db, { email: "theme-owner@platform.test", role: "platform_owner" })).userId;
  SUPPORT_STAFF = (await seedPlatformStaff(platform._db.db, { email: "theme-support@platform.test", role: "platform_support" })).userId;
}, 240_000);

afterAll(async () => {
  await pg?.end();
  await rwDb?.close();
  await web?.close();
  await platform?.close();
  await container?.stop();
});

describe("launch theme", () => {
  it("is seeded, published, and every page validates against the block registry", async () => {
    const [row] = await rows<{ is_active: boolean; default_pages: Record<string, BlockInstance[]>; default_tokens: unknown }>(
      `select is_active, default_pages, default_tokens from theme_templates where code = $1`,
      [LAUNCH_TEMPLATE_CODE],
    );
    expect(row?.is_active).toBe(true);
    for (const blocks of Object.values(row!.default_pages)) {
      const r = validateBlockDocument({ version: 1, blocks });
      expect(r.success, JSON.stringify(r)).toBe(true);
    }
  });

  it("migration JSON matches launch-template.ts (keeps the two sources from drifting)", async () => {
    const [row] = await rows<{ default_pages: unknown; default_tokens: unknown }>(
      `select default_pages, default_tokens from theme_templates where code = $1`,
      [LAUNCH_TEMPLATE_CODE],
    );
    expect(row?.default_pages).toEqual({ home: LAUNCH_TEMPLATE_HOME });
    expect(row?.default_tokens).toEqual(LAUNCH_TEMPLATE_TOKENS);
  });
});

describe("store theme library and activation", () => {
  it("lists only published templates", async () => {
    const lib = await listThemeLibrary(web, ctxFor(TENANT_A));
    expect(lib.map((t) => t.code)).toContain(LAUNCH_TEMPLATE_CODE);
    expect(lib.find((t) => t.code === LAUNCH_TEMPLATE_CODE)?.isCurrent).toBe(false);
  });

  it("requires the theme.publish permission", async () => {
    await expect(
      activateTheme(web, { ...ctxFor(TENANT_A), permissions: ["content.write"] }, { code: LAUNCH_TEMPLATE_CODE }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("rejects unknown or unpublished templates", async () => {
    await expect(activateTheme(web, ctxFor(TENANT_A), { code: "nope" })).rejects.toThrow(/not available/);
  });

  it("copies tokens and the home page into the store and publishes it", async () => {
    const res = await activateTheme(web, ctxFor(TENANT_A), { code: LAUNCH_TEMPLATE_CODE });
    expect(res.pages).toContain("home");

    const [theme] = await rows<{ template_code: string; template_version: number; tokens: unknown }>(
      `select template_code, template_version, tokens from themes where tenant_id = $1`,
      [TENANT_A],
    );
    expect(theme?.template_code).toBe(LAUNCH_TEMPLATE_CODE);
    expect(theme?.tokens).toEqual(LAUNCH_TEMPLATE_TOKENS);

    const home = await getStorefrontHomePage(web, storefrontCtx(TENANT_A));
    const ids = (home.document.blocks as BlockInstance[]).map((b) => b.id);
    expect(ids).toEqual(LAUNCH_TEMPLATE_HOME.map((b) => b.id));

    const lib = await listThemeLibrary(web, ctxFor(TENANT_A));
    expect(lib.find((t) => t.code === LAUNCH_TEMPLATE_CODE)).toMatchObject({ isCurrent: true, updateAvailable: false });
  });

  it("does not touch another store", async () => {
    const pages = await rows(`select 1 from pages where tenant_id = $1`, [TENANT_B]);
    expect(pages).toHaveLength(0);
  });

  it("keeps the store's customizations when the platform publishes a newer template version", async () => {
    const [homePage] = await rows<{ id: string }>(`select id from pages where tenant_id = $1 and type = 'home'`, [TENANT_A]);
    const pageId = homePage!.id;

    // Store owner customizes the home page and publishes it.
    const page = await getPage(web, ctxFor(TENANT_A), { id: pageId, draft: true });
    const blocks = (page.blocks as BlockInstance[]).map((b) =>
      b.id === "ec-hero" ? { ...b, props: { ...b.props, title: "My store's own headline" } } : b,
    );
    await savePageDraft(web, ctxFor(TENANT_A), { id: pageId, blocks });
    await publishPage(web, ctxFor(TENANT_A), { id: pageId });

    // Platform edits the template and publishes v2.
    const tpl = LAUNCH_TEMPLATE_HOME.map((b) => (b.id === "ec-hero" ? { ...b, props: { ...b.props, title: "Platform v2 headline" } } : b));
    await saveThemeTemplateDraft(platform, OWNER_STAFF, { code: LAUNCH_TEMPLATE_CODE, pages: { home: tpl } });
    const { version } = await publishThemeTemplate(platform, OWNER_STAFF, LAUNCH_TEMPLATE_CODE);
    expect(version).toBe(2);

    const home = await getStorefrontHomePage(web, storefrontCtx(TENANT_A));
    const hero = (home.document.blocks as BlockInstance[]).find((b) => b.id === "ec-hero");
    expect(hero?.props.title).toBe("My store's own headline");

    const lib = await listThemeLibrary(web, ctxFor(TENANT_A));
    expect(lib.find((t) => t.code === LAUNCH_TEMPLATE_CODE)).toMatchObject({ isCurrent: true, updateAvailable: true, installedVersion: 1 });
  });

  it("re-activating adds a version instead of deleting history, so the old design can be rolled back", async () => {
    const [homePage] = await rows<{ id: string }>(`select id from pages where tenant_id = $1 and type = 'home'`, [TENANT_A]);
    const before = await listPageVersions(web, ctxFor(TENANT_A), { id: homePage!.id });
    await activateTheme(web, ctxFor(TENANT_A), { code: LAUNCH_TEMPLATE_CODE });
    const after = await listPageVersions(web, ctxFor(TENANT_A), { id: homePage!.id });
    expect(after.length).toBe(before.length + 1);
    expect(after.filter((v) => v.isPublished)).toHaveLength(1);
    expect(after[0]?.isPublished).toBe(true);
  });
});

describe("page drafts", () => {
  it("getPage(draft) returns the draft while the storefront keeps serving the published page", async () => {
    const [homePage] = await rows<{ id: string }>(`select id from pages where tenant_id = $1 and type = 'home'`, [TENANT_A]);
    const pageId = homePage!.id;
    const current = await getPage(web, ctxFor(TENANT_A), { id: pageId, draft: true });
    const edited = (current.blocks as BlockInstance[]).map((b) =>
      b.id === "ec-hero" ? { ...b, props: { ...b.props, title: "Unpublished draft title" } } : b,
    );
    await savePageDraft(web, ctxFor(TENANT_A), { id: pageId, blocks: edited });

    const draft = await getPage(web, ctxFor(TENANT_A), { id: pageId, draft: true });
    expect(draft.hasUnpublishedChanges).toBe(true);
    expect((draft.blocks as BlockInstance[]).find((b) => b.id === "ec-hero")?.props.title).toBe("Unpublished draft title");

    const live = await getStorefrontHomePage(web, storefrontCtx(TENANT_A));
    expect((live.document.blocks as BlockInstance[]).find((b) => b.id === "ec-hero")?.props.title).not.toBe("Unpublished draft title");
  });

  it("rejects invalid documents on save (unsafe link)", async () => {
    const [homePage] = await rows<{ id: string }>(`select id from pages where tenant_id = $1 and type = 'home'`, [TENANT_A]);
    await expect(
      savePageDraft(web, ctxFor(TENANT_A), {
        id: homePage!.id,
        blocks: [{ id: "x", type: "Button", version: 1, props: { label: "Go", href: "javascript:alert(1)" } }],
      }),
    ).rejects.toThrow(/Validation failed/);
  });
});

describe("block data", () => {
  const block = (id: string, type: string, props: Record<string, unknown>): BlockInstance => ({ id, type: type as BlockInstance["type"], version: 1, props });

  it("resolves featured, newest and manual product sources, hiding drafts", async () => {
    const data = await resolveBlockData(web, storefrontCtx(TENANT_A), [
      block("f", "ProductCarousel", { title: "F", source: "featured" }),
      block("n", "ProductGrid", { title: "N", source: "newest", limit: 10 }),
      block("m", "ProductGrid", { title: "M", source: "manual", productSlugs: ["plain-jar", "missing", "draft-jar"] }),
      block("nested", "Section", { content: [block("inner", "ProductCarousel", { title: "I", source: "newest" })] }),
    ]);
    const titles = (id: string) => (data[id]?.kind === "products" ? data[id].products.map((p) => p.title) : []);
    expect(titles("f")).toEqual(["Featured Jar"]);
    expect(titles("n").sort()).toEqual(["Featured Jar", "Plain Jar"]);
    expect(titles("m")).toEqual(["Plain Jar"]);
    expect(titles("inner").length).toBe(2); // found inside a layout block
  });

  it("does not leak another store's products", async () => {
    const data = await resolveBlockData(web, storefrontCtx(TENANT_B), [block("n", "ProductGrid", { title: "N", source: "newest" })]);
    expect(data.n?.kind === "products" ? data.n.products : []).toHaveLength(0);
  });
});

describe("platform template management", () => {
  it("only admins/owners can edit; support staff cannot", async () => {
    await expect(createThemeTemplate(platform, SUPPORT_STAFF, { name: "Nope" })).rejects.toThrow(/Forbidden/);
  });

  it("new templates are hidden from stores until published, and invalid drafts are rejected", async () => {
    const created = await createThemeTemplate(platform, OWNER_STAFF, { name: "Test Theme", cloneFromCode: LAUNCH_TEMPLATE_CODE });
    expect(created.isActive).toBe(false);
    expect((await listThemeLibrary(web, ctxFor(TENANT_A))).map((t) => t.code)).not.toContain(created.code);
    await expect(activateTheme(web, ctxFor(TENANT_A), { code: created.code })).rejects.toThrow(/not available/);

    await expect(
      saveThemeTemplateDraft(platform, OWNER_STAFF, {
        code: created.code,
        pages: { home: [{ id: "g", type: "Ghost" as never, version: 1, props: {} }] },
      }),
    ).rejects.toThrow(/invalid/i);
    await expect(saveThemeTemplateDraft(platform, OWNER_STAFF, { code: created.code, pages: { about: [] } })).rejects.toThrow(/home/);

    await publishThemeTemplate(platform, OWNER_STAFF, created.code);
    expect((await listThemeLibrary(web, ctxFor(TENANT_A))).map((t) => t.code)).toContain(created.code);

    // Unpublishing hides it again without touching stores that already copied it.
    await updateThemeTemplateMeta(platform, OWNER_STAFF, { code: created.code, isActive: false });
    expect((await listThemeLibrary(web, ctxFor(TENANT_A))).map((t) => t.code)).not.toContain(created.code);
  });

  it("writes an audit log entry for publish", async () => {
    const logs = await rows<{ action: string }>(`select action from platform_audit_logs where action like 'theme_template.%'`);
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["theme_template.create", "theme_template.publish"]));
  });

  it("lists templates with draft status", async () => {
    const list = await listThemeTemplates(platform, OWNER_STAFF);
    expect(list.find((t) => t.code === LAUNCH_TEMPLATE_CODE)?.version).toBe(2);
  });
});
