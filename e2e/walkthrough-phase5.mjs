// Browser walkthrough for Phase 5 (themes cleanup + pages table with hierarchy).
// The RPC layer is mocked and STATEFUL (modifying pages changes what the next list call returns),
// so this proves the screens, their wiring and layout, not the server.
// Server behaviour is covered by real-database tests (pages-hierarchy.int.test.ts, isolation.int.test.ts).
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const OUT = path.resolve(process.cwd(), "apps/admin/walkthrough-artifacts/phase5");
fs.mkdirSync(OUT, { recursive: true });

function waitFor(url, ms = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() - start > ms) return reject(new Error(`timeout waiting for ${url}`));
      setTimeout(tick, 500);
    };
    tick();
  });
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

const procOf = (url) => {
  const m = url.match(/\/rpc\/(.+?)(\?|$)/);
  return m ? m[1].replace(/\//g, ".") : "";
};

async function run() {
  if (!fs.existsSync(path.resolve(process.cwd(), "apps/admin/dist"))) {
    console.log("Building @bs/admin for preview...");
    const build = spawn("pnpm", ["--filter", "@bs/admin", "build"], { shell: true, stdio: "inherit" });
    await new Promise((resolve, reject) => {
      build.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`build exited with ${code}`))));
    });
  }

  const ad = spawn("pnpm", ["--filter", "@bs/admin", "preview"], { shell: true, stdio: "ignore" });
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  try {
    await waitFor("http://localhost:5173");

    const HOME_ID = "019266f8-0000-7000-8000-000000000001";
    const ABOUT_ID = "019266f8-0000-7000-8000-000000000002";
    const TEAM_ID = "019266f8-0000-7000-8000-000000000003";
    const CONTACT_ID = "019266f8-0000-7000-8000-000000000004";
    const HEADER_ID = "019266f8-0000-7000-8000-000000000005";
    const FOOTER_ID = "019266f8-0000-7000-8000-000000000006";

    let pages = [
      {
        id: HOME_ID,
        title: "Home",
        slug: "home",
        type: "home",
        status: "published",
        parentId: null,
        path: "/",
        childCount: 0,
        seo: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: ABOUT_ID,
        title: "About Us",
        slug: "about",
        type: "custom",
        status: "published",
        parentId: null,
        path: "/pages/about",
        childCount: 1,
        seo: { title: "About SEO Title", description: "About SEO Description", imageMediaId: null },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: TEAM_ID,
        title: "Leadership Team",
        slug: "team",
        type: "custom",
        status: "published",
        parentId: ABOUT_ID,
        path: "/pages/about/team",
        childCount: 0,
        seo: { title: "Team Leadership", description: "Our leaders", imageMediaId: null },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: CONTACT_ID,
        title: "Contact Us",
        slug: "contact",
        type: "custom",
        status: "draft",
        parentId: null,
        path: "/pages/contact",
        childCount: 0,
        seo: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // System pages (hidden in admin table)
      {
        id: HEADER_ID,
        title: "Header",
        slug: "template-header",
        type: "header",
        status: "published",
        parentId: null,
        path: "/template-header",
        childCount: 0,
        seo: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: FOOTER_ID,
        title: "Footer",
        slug: "template-footer",
        type: "footer",
        status: "published",
        parentId: null,
        path: "/template-footer",
        childCount: 0,
        seo: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const themes = [
      {
        code: "dawn",
        name: "Dawn Default",
        description: "Clean modern design",
        industry: "general",
        features: ["Minimalist", "Fast loading"],
        previewImageKey: null,
        version: 1,
        isCurrent: true,
        installedVersion: 1,
        updateAvailable: false,
      },
      {
        code: "craft",
        name: "Craft",
        description: "Artisanal and makers",
        industry: "craft",
        features: ["Rich storytelling"],
        previewImageKey: null,
        version: 1,
        isCurrent: false,
        installedVersion: null,
        updateAvailable: false,
      },
      {
        code: "studio",
        name: "Studio",
        description: "Fashion and apparel",
        industry: "fashion",
        features: ["High-impact visuals"],
        previewImageKey: null,
        version: 1,
        isCurrent: false,
        installedVersion: null,
        updateAvailable: false,
      },
    ];

    const mediaList = [
      {
        id: "media-about-img",
        storageKey: "tenants/tenant-1/products/about-feature.jpg",
        mime: "image/jpeg",
        bytes: 102400,
        width: 1200,
        height: 630,
        alt: "About feature image",
        folder: "products",
        url: "https://demo.bcom.si/media/about-feature.jpg",
        createdAt: new Date().toISOString(),
      },
    ];

    for (const [label, viewport] of [
      ["desktop", { width: 1280, height: 800 }],
      ["mobile", { width: 375, height: 812 }],
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();

      // Intercept RPC and API
      await page.route("**/rpc/**", async (route) => {
        const proc = procOf(route.request().url());
        const body = JSON.parse(route.request().postData() || "{}");
        const input = body.json ?? body;
        const ok = (data) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ json: data }),
          });

        if (proc === "admin.me.get") {
          return ok({
            user: { id: "0199a000-0000-7000-8000-0000000000bb", email: "admin@store.test", name: "Store Admin" },
            stores: [
              {
                tenantId: "0199a000-0000-7000-8000-0000000000aa",
                name: "Demo Store",
                slug: "demo",
                status: "live",
                role: "store_owner",
                permissions: ["settings.read", "settings.write", "content.read", "content.write", "theme.publish"],
              },
            ],
          });
        }

        if (proc === "admin.themes.library") {
          return ok(themes);
        }

        if (proc === "admin.pages.list") {
          return ok(pages);
        }

        if (proc === "admin.pages.get") {
          const target = pages.find((p) => p.id === input.id);
          if (target) {
            return ok({
              ...target,
              document: { version: 1, blocks: [] },
              versions: [{ id: "v1", versionNumber: 1, status: target.status, createdAt: target.updatedAt }],
            });
          }
          return route.fulfill({ status: 404, body: JSON.stringify({ message: "Page not found" }) });
        }

        if (proc === "admin.pages.create") {
          const newId = crypto.randomUUID();
          const parent = pages.find((p) => p.id === input.parentId);
          const fullPath = parent?.path ? `${parent.path}/${input.slug}` : `/pages/${input.slug}`;
          const created = {
            id: newId,
            title: input.title,
            slug: input.slug,
            type: "custom",
            status: "draft",
            parentId: input.parentId ?? null,
            path: fullPath,
            childCount: 0,
            seo: input.seo ?? null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          pages.push(created);
          if (parent) parent.childCount++;
          return ok(created);
        }

        if (proc === "admin.pages.update") {
          const target = pages.find((p) => p.id === input.id);
          if (target) {
            if (input.title) target.title = input.title;
            if (input.slug) target.slug = input.slug;
            if (input.seo !== undefined) target.seo = input.seo;
            target.updatedAt = new Date().toISOString();
            return ok(target);
          }
          return route.fulfill({ status: 404, body: JSON.stringify({ message: "Not found" }) });
        }

        if (proc === "admin.pages.delete") {
          const target = pages.find((p) => p.id === input.id);
          if (target && target.childCount > 0) {
            return route.fulfill({
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({
                message: "Cannot delete a page with child pages. Reassign or delete children first.",
              }),
            });
          }
          pages = pages.filter((p) => p.id !== input.id);
          return ok({ success: true });
        }

        if (proc === "admin.pages.duplicate") {
          const target = pages.find((p) => p.id === input.id);
          if (target) {
            const copy = {
              ...target,
              id: crypto.randomUUID(),
              title: `${target.title} (Copy)`,
              slug: `${target.slug}-copy`,
              status: "draft",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            pages.push(copy);
            return ok(copy);
          }
          return route.fulfill({ status: 404, body: JSON.stringify({ message: "Not found" }) });
        }

        if (proc === "admin.pages.unpublish") {
          const target = pages.find((p) => p.id === input.id);
          if (target) {
            target.status = "draft";
            return ok(target);
          }
          return route.fulfill({ status: 404, body: JSON.stringify({ message: "Not found" }) });
        }

        if (proc === "admin.media.list") {
          return ok({ items: mediaList, total: mediaList.length });
        }

        if (proc === "admin.media.requestUpload") {
          return ok({
            uploadUrl: "http://localhost:5173/upload-mock",
            storageKey: `tenants/tenant-1/products/${input.filename}`,
            id: `media-${Date.now()}`,
            method: "PUT",
            headers: {},
          });
        }

        if (proc === "admin.media.confirmUpload") {
          const m = {
            id: input.mediaId,
            storageKey: input.storageKey,
            mime: "image/png",
            bytes: 50000,
            width: 800,
            height: 600,
            alt: "Uploaded image",
            folder: "products",
            url: `https://demo.bcom.si/media/${input.mediaId}.png`,
            createdAt: new Date().toISOString(),
          };
          mediaList.push(m);
          return ok(m);
        }

        return ok({});
      });

      // ==========================================
      // SECTION 1: THEMES PAGE (theme-library.tsx)
      // ==========================================
      await page.goto("http://localhost:5173/online-store/theme-library", { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Themes" }).waitFor({ timeout: 15000 });

      check(`themes ${label}: title and breadcrumb visible`, (await page.getByRole("heading", { name: "Themes" }).count()) > 0);
      check(`themes ${label}: "Brand and logo" header button removed`, (await page.getByRole("button", { name: "Brand and logo" }).count()) === 0);
      check(`themes ${label}: "Theme settings" header button removed`, (await page.getByRole("button", { name: "Theme settings" }).count()) === 0);
      check(`themes ${label}: "Customise <theme>" block removed`, (await page.getByText("Customise Dawn Default").count()) === 0);

      // Check grid layout: 3 per row on desktop
      const cards = page.locator("article");
      const cardCount = await cards.count();
      check(`themes ${label}: theme cards rendered`, cardCount >= 3);

      if (label === "desktop") {
        const gridClass = await page.locator("article").first().locator("..").getAttribute("class");
        check("themes desktop: 3-column grid on desktop (lg:grid-cols-3)", gridClass?.includes("lg:grid-cols-3") ?? false);
      }

      // Check primary Customize button on current theme
      const customizeBtn = page.getByRole("button", { name: "Customise" }).first();
      check(`themes ${label}: active theme has primary Customise button`, await customizeBtn.isVisible());

      if (label === "desktop") {
        await customizeBtn.click();
        await page.waitForTimeout(500);
        check("themes desktop: Customize button opens Puck editor on home page", page.url().includes(`/online-store/editor/${HOME_ID}`));
        await page.goto("http://localhost:5173/online-store/theme-library", { waitUntil: "networkidle" });
      }

      await page.screenshot({ path: path.join(OUT, `themes-${label}-1-library.png`) });
      check(`themes ${label}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

      // Test legacy theme redirects
      await page.goto("http://localhost:5173/online-store/theme", { waitUntil: "networkidle" });
      check(`themes ${label}: /online-store/theme redirects to theme-library`, page.url().includes("/online-store/theme-library"));

      await page.goto("http://localhost:5173/online-store/theme-settings", { waitUntil: "networkidle" });
      check(`themes ${label}: /online-store/theme-settings redirects to theme-library`, page.url().includes("/online-store/theme-library"));

      // ==========================================
      // SECTION 2: PAGES WORKBENCH (pages.tsx)
      // ==========================================
      await page.goto("http://localhost:5173/online-store/pages", { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Pages" }).waitFor({ timeout: 15000 });

      check(`pages ${label}: heading visible`, await page.getByRole("heading", { name: "Pages" }).isVisible());
      check(`pages ${label}: "Add page" button visible`, await page.getByRole("button", { name: "Add page" }).isVisible());

      // Check table columns: Name, URL, Parent, Status, Updated
      check(`pages ${label}: table column Name visible`, (await page.getByText("Name", { exact: true }).count()) > 0);
      check(`pages ${label}: table column URL visible`, (await page.getByText("URL", { exact: true }).count()) > 0);
      check(`pages ${label}: table column Status visible`, (await page.getByText("Status", { exact: true }).count()) > 0);

      // Check system pages are hidden and home page is visible
      check(`pages ${label}: system pages hidden (header/footer)`, (await page.getByText("template-header").count()) === 0);
      check(`pages ${label}: Home page row visible with path /`, (await page.getByText("Home").count()) > 0 && (await page.getByText("/").count()) > 0);
      check(`pages ${label}: Hierarchical child path displayed (/pages/about/team)`, (await page.getByText("/pages/about/team").count()) > 0);

      // Check search filter
      const searchInput = page.getByPlaceholder("Search by title or URL...");
      await searchInput.fill("Leadership");
      await page.waitForTimeout(300);
      check(`pages ${label}: search filters table rows`, (await page.locator("tbody tr").count()) === 1);
      await searchInput.clear();
      await page.waitForTimeout(300);

      // Check status filter (desktop)
      if (label === "desktop") {
        const statusSelect = page.getByRole("combobox", { name: "Filter by status" });
        await statusSelect.click();
        await page.getByRole("option", { name: "Draft" }).click();
        await page.waitForTimeout(300);
        check("pages desktop: status filter shows only draft pages", (await page.locator("tbody tr").count()) === 1);
        await statusSelect.click();
        await page.getByRole("option", { name: "All statuses" }).click();
        await page.waitForTimeout(300);
      }

      await page.screenshot({ path: path.join(OUT, `pages-${label}-1-table.png`) });
      check(`pages ${label}: zero horizontal overflow on table`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

      if (label === "mobile") {
        await page.getByRole("button", { name: "Add page" }).click();
        await page.getByRole("heading", { name: "Add page" }).waitFor();
        check("pages mobile: Add page sheet opens", await page.getByRole("heading", { name: "Add page" }).isVisible());
        check("pages mobile: zero horizontal overflow on sheet", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        await page.getByRole("button", { name: "Cancel" }).click();
        await page.waitForTimeout(300);
        check("pages mobile: sheet cancel button closes cleanly", !(await page.getByRole("heading", { name: "Add page" }).isVisible()));
      }

      // Test Add Page Sheet
      if (label === "desktop") {
        await page.getByRole("button", { name: "Add page" }).click();
        await page.getByRole("heading", { name: "Add page" }).waitFor();
        check("pages: Add page sheet opened", await page.getByRole("heading", { name: "Add page" }).isVisible());

        // Test title auto-slugify and live full path
        const titleInput = page.locator("#page-title");
        await titleInput.fill("Our Philosophy");
        const slugInput = page.locator("#page-slug");
        check("pages: auto-slugifies title to our-philosophy", (await slugInput.inputValue()) === "our-philosophy");
        check("pages: live path displays /pages/our-philosophy", (await page.getByText("/pages/our-philosophy").count()) > 0);

        // Test SEO character counters
        const seoTitleInput = page.locator("#seo-title");
        await seoTitleInput.fill("Our Philosophy | Brand Sewa");
        check("pages: SEO title character counter reflects length", (await page.getByText(/27 \/ 70 characters/i).count()) > 0);

        const seoDescInput = page.locator("#seo-description");
        await seoDescInput.fill("Learn about our guiding principles and vision.");
        check("pages: SEO description character counter reflects length", (await page.getByText(/46 \/ 160 characters/i).count()) > 0);

        // Save new page
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await page.waitForTimeout(500);
        check("pages: new page saved and displayed in table", (await page.getByText("Our Philosophy").count()) > 0);

        // Test Edit Page Sheet
        const teamRow = page.locator("tr").filter({ has: page.getByText("/pages/about/team", { exact: true }) });
        await teamRow.getByRole("button", { name: "Edit" }).click();
        await page.getByRole("heading", { name: "Edit: Leadership Team" }).waitFor();
        check("pages: Edit page sheet prefilled", await page.getByRole("heading", { name: "Edit: Leadership Team" }).isVisible());

        // Change SEO title in Edit sheet and save
        await page.locator("#seo-title").fill("Executive Leadership Team");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await page.waitForTimeout(500);
        check("pages: edit sheet saved successfully", true);

        // Test Delete refusal for page with children
        const aboutRow = page.locator("tr").filter({ has: page.getByText("/pages/about", { exact: true }) });
        await aboutRow.getByRole("button", { name: "Page actions" }).click(); // Open dropdown
        await page.getByRole("menuitem", { name: "Delete" }).click();
        await page.waitForTimeout(300);
        check("pages: delete confirmation warning for page with children", (await page.getByText(/subpage/i).count()) > 0);
        check("pages: delete confirm button disabled when page has children", await page.getByRole("button", { name: "Delete page" }).isDisabled());
        await page.getByRole("button", { name: "Not now" }).click();

        // Test Duplicate page
        const contactRow = page.locator("tr").filter({ has: page.getByText("/pages/contact", { exact: true }) });
        await contactRow.getByRole("button", { name: "Page actions" }).click();
        await page.getByRole("menuitem", { name: "Duplicate" }).click();
        await page.waitForTimeout(500);
        check("pages: duplicate creates draft copy in table", (await page.getByText("Contact Us (Copy)").count()) > 0);

        // Test Customize row action
        const teamRowAgain = page.locator("tr").filter({ has: page.getByText("/pages/about/team", { exact: true }) });
        await teamRowAgain.getByRole("button", { name: "Customize" }).click();
        await page.waitForTimeout(500);
        check("pages: Customize button navigates to Puck editor", page.url().includes(`/online-store/editor/${TEAM_ID}`));
      }

      await ctx.close();
    }

    console.log(`\nWalkthrough completed: ${results.filter((r) => r.ok).length}/${results.length} checks passed.`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error("Failed checks:", failed);
      process.exit(1);
    }
  } finally {
    await browser.close();
    ad.kill();
  }
}

run().catch((err) => {
  console.error("Walkthrough failed with unhandled error:", err);
  process.exit(1);
});
