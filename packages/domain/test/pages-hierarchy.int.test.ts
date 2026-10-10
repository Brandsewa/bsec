import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createMenu,
  createPage,
  createRuntime,
  deletePage,
  getPage,
  getStorefrontPageByPath,
  listPages,
  provisionTenant,
  publishPage,
  resolveMediaUrlById,
  updatePage,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;

const ctxFor = (tenantId: string, ownerId: string): TenantContext => ({
  tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: ownerId },
  roles: ["store_owner"],
  permissions: ["content.read", "content.write", "theme.publish"],
  requestId: "req_pages_hierarchy_test",
});

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });

  const a = await provisionTenant(rt, {
    storeName: "pages-tenant-a",
    slug: "pages-tenant-a",
    owner: { email: "owner-a@pages.test", name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  const b = await provisionTenant(rt, {
    storeName: "pages-tenant-b",
    slug: "pages-tenant-b",
    owner: { email: "owner-b@pages.test", name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });

  ctxA = ctxFor(a.tenantId, a.ownerId);
  ctxB = ctxFor(b.tenantId, b.ownerId);
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("Page hierarchy, canonical paths, and constraints (Phase 5)", () => {
  it("rejects parent in another tenant via composite tenant foreign key", async () => {
    const pageA = await createPage(rtWeb, ctxA, {
      title: "Store A Root Page",
      slug: "store-a-root",
    });

    // Tenant B attempts to set pageA as its parent
    await expect(
      createPage(rtWeb, ctxB, {
        title: "Store B Attack Page",
        slug: "store-b-attack",
        parentId: pageA.id,
      }),
    ).rejects.toThrow();
  });

  it("rejects cycle in hierarchy (A -> B -> A)", async () => {
    const pageA = await createPage(rtWeb, ctxA, {
      title: "Cycle Node A",
      slug: "cycle-node-a",
    });

    const pageB = await createPage(rtWeb, ctxA, {
      title: "Cycle Node B",
      slug: "cycle-node-b",
      parentId: pageA.id,
    });

    // Setting pageA's parent to pageB forms a cycle
    await expect(
      updatePage(rtWeb, ctxA, {
        id: pageA.id,
        parentId: pageB.id,
      }),
    ).rejects.toThrow(/circular|cycle/i);
  });

  it("rejects hierarchy depth 4 (max depth 3)", async () => {
    // Level 1
    const l1 = await createPage(rtWeb, ctxA, {
      title: "Level 1 Page",
      slug: "level-1",
    });

    // Level 2
    const l2 = await createPage(rtWeb, ctxA, {
      title: "Level 2 Page",
      slug: "level-2",
      parentId: l1.id,
    });

    // Level 3
    const l3 = await createPage(rtWeb, ctxA, {
      title: "Level 3 Page",
      slug: "level-3",
      parentId: l2.id,
    });

    // Level 4 (should be rejected)
    await expect(
      createPage(rtWeb, ctxA, {
        title: "Level 4 Page",
        slug: "level-4",
        parentId: l3.id,
      }),
    ).rejects.toThrow(/depth.*3/i);
  });

  it("rejects duplicate slugs within the same tenant and allows them across tenants", async () => {
    await createPage(rtWeb, ctxA, {
      title: "FAQ Page A",
      slug: "tenant-faq",
    });

    // Same tenant duplicate slug
    await expect(
      createPage(rtWeb, ctxA, {
        title: "Duplicate FAQ",
        slug: "tenant-faq",
      }),
    ).rejects.toThrow();

    // Different tenant can use the same slug
    const pageB = await createPage(rtWeb, ctxB, {
      title: "FAQ Page B",
      slug: "tenant-faq",
    });
    expect(pageB.slug).toBe("tenant-faq");
  });

  it("rejects reserved and system slugs", async () => {
    await expect(
      createPage(rtWeb, ctxA, {
        title: "Cart Override",
        slug: "cart",
      }),
    ).rejects.toThrow(/reserved/i);

    await expect(
      createPage(rtWeb, ctxA, {
        title: "Template Fake",
        slug: "template-fake",
      }),
    ).rejects.toThrow(/template-/i);
  });

  it("refuses deletion when page has children", async () => {
    const parent = await createPage(rtWeb, ctxA, {
      title: "Parent To Delete",
      slug: "parent-to-delete",
    });

    await createPage(rtWeb, ctxA, {
      title: "Child Page",
      slug: "child-of-parent",
      parentId: parent.id,
    });

    await expect(
      deletePage(rtWeb, ctxA, { id: parent.id }),
    ).rejects.toThrow(/Cannot delete page: It has child pages/i);
  });

  it("refuses deletion when page is referenced by a navigation menu", async () => {
    const terms = await createPage(rtWeb, ctxA, {
      title: "Terms and Conditions",
      slug: "terms-and-conditions",
    });

    // Create a menu referencing the terms page path
    await createMenu(rtWeb, ctxA, {
      name: "Main Menu",
      handle: "main-menu-terms",
      items: [
        {
          id: "item-1",
          title: "Terms",
          url: terms.path,
        },
      ],
    });

    await expect(
      deletePage(rtWeb, ctxA, { id: terms.id }),
    ).rejects.toThrow(/Cannot delete page: It is referenced by navigation menu/i);
  });

  it("computes canonical paths, persists parent under RLS, and resolves storefront paths", async () => {
    const company = await createPage(rtWeb, ctxA, {
      title: "Company",
      slug: "company",
    });
    expect(company.path).toBe("/pages/company");

    const about = await createPage(rtWeb, ctxA, {
      title: "About Us",
      slug: "about-us",
      parentId: company.id,
    });
    expect(about.path).toBe("/pages/company/about-us");

    const leadership = await createPage(rtWeb, ctxA, {
      title: "Leadership Team",
      slug: "leadership",
      parentId: about.id,
    });
    expect(leadership.path).toBe("/pages/company/about-us/leadership");

    // Verify listPages reports children counts and correct paths under RLS
    const listed = await listPages(rtWeb, ctxA);
    const listedCompany = listed.find((p) => p.id === company.id);
    const listedAbout = listed.find((p) => p.id === about.id);
    const listedLeadership = listed.find((p) => p.id === leadership.id);

    expect(listedCompany?.childCount).toBe(1);
    expect(listedAbout?.childCount).toBe(1);
    expect(listedLeadership?.childCount).toBe(0);

    // Verify getPage returns canonical path
    const fetched = await getPage(rtWeb, ctxA, { id: leadership.id });
    expect(fetched.path).toBe("/pages/company/about-us/leadership");

    // Publish pages to test storefront resolution
    await publishPage(rtWeb, ctxA, { id: company.id });
    await publishPage(rtWeb, ctxA, { id: about.id });
    await publishPage(rtWeb, ctxA, { id: leadership.id });

    // Storefront resolution:
    // 1. Direct canonical path match
    const resolvedCanonical = await getStorefrontPageByPath(rtWeb, ctxA, [
      "company",
      "about-us",
      "leadership",
    ]);
    expect(resolvedCanonical).not.toBeNull();
    expect(resolvedCanonical?.page.id).toBe(leadership.id);
    expect(resolvedCanonical?.isCanonical).toBe(true);
    expect(resolvedCanonical?.canonicalPath).toBe("/pages/company/about-us/leadership");

    // 2. Non-canonical ancestor path returns isCanonical: false with canonicalPath
    const nonCanonical = await getStorefrontPageByPath(rtWeb, ctxA, [
      "wrong-ancestor",
      "leadership",
    ]);
    expect(nonCanonical).not.toBeNull();
    expect(nonCanonical?.isCanonical).toBe(false);
    expect(nonCanonical?.canonicalPath).toBe("/pages/company/about-us/leadership");

    // 3. Single slug path returns isCanonical: false with canonicalPath
    const shallow = await getStorefrontPageByPath(rtWeb, ctxA, ["leadership"]);
    expect(shallow).not.toBeNull();
    expect(shallow?.isCanonical).toBe(false);
    expect(shallow?.canonicalPath).toBe("/pages/company/about-us/leadership");

    // 4. Unknown path returns null
    const notFound = await getStorefrontPageByPath(rtWeb, ctxA, [
      "nonexistent-page-slug",
    ]);
    expect(notFound).toBeNull();
  });

  it("resolves media URL safely with graceful undefined on missing/deleted media", async () => {
    // 1. null / undefined media ID returns undefined
    const nullResult = await resolveMediaUrlById(rtWeb, ctxA.tenantId, null);
    expect(nullResult).toBeUndefined();

    const undefResult = await resolveMediaUrlById(rtWeb, ctxA.tenantId, undefined);
    expect(undefResult).toBeUndefined();

    // 2. Non-existent or deleted media ID returns undefined without error
    const fakeId = "019266f8-4567-7000-8000-000000000999";
    const missingResult = await resolveMediaUrlById(rtWeb, ctxA.tenantId, fakeId);
    expect(missingResult).toBeUndefined();
  });
});

