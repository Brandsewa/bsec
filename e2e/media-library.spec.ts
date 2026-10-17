import { expect, test, request as pwRequest, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureFixturesExist, makePatternPng } from "./fixtures/setup-fixtures.ts";

/**
 * Real end-to-end suite for the Media library (no API mocking).
 * Runs against a live stack: the admin SPA, the web app/API, the worker and Postgres, with a local
 * storage driver so uploads, derived images, downloads and the storefront are real.
 *
 * Data is arranged through the admin API with the signed-in browser session; everything the merchant
 * does is driven through the UI; results are asserted on the UI, the API and the storefront.
 * No assertion sits behind an `if (visible)` guard: if the UI is missing, the test fails.
 */
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:8080";
const API = process.env.API_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.E2E_EMAIL ?? "owner@ci.example";
const PASSWORD = process.env.E2E_PASSWORD ?? "";
// The store this login owns, and the host that serves its storefront (a `domains` row must exist for it).
const STORE_ID = process.env.E2E_STORE_ID ?? "0199b000-0000-7000-8000-000000000001";
const STORE_HOST = process.env.E2E_STORE_HOST ?? "ci-store.bcom.si";
// A real browser reaches the storefront at the store host on the web app's port (see launchOptions in playwright.config.ts)
const STORE_URL = `http://${STORE_HOST}:${new URL(API).port || "80"}`;

const run = Date.now().toString(36);
const NAME = {
  png: `e2e${run}-pattern.png`,
  png2: `e2e${run}-replacement.png`,
  mp4: `e2e${run}-clip.mp4`,
  pdf: `e2e${run}-manual.pdf`,
  docx: `e2e${run}-terms.docx`,
};

interface MediaRow {
  id: string;
  kind: string;
  filename: string | null;
  url: string;
  storageKey?: string;
  width: number | null;
  height: number | null;
  alt: string | null;
  title: string | null;
  focalX: number | null;
  focalY: number | null;
  status: string;
  derivatives: Record<string, { key: string }> | null;
}

let files: { png: string; png2: string; mp4: string; pdf: string; docx: string; svg: string; bigJpg: string; bigMp4: string };
const ids: { png?: string; pdf?: string; productId?: string; productSlug?: string; productTitle?: string } = {};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("Set E2E_PASSWORD (the seeded owner login)");
  const base = ensureFixturesExist();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bsec-e2e-media-"));
  const put = (name: string, data: Buffer | string) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, data);
    return p;
  };
  // Unique bytes per run: the library offers "Use existing" for a file it already holds (duplicate detection)
  const salt = Math.floor(Math.random() * 0xffffff);
  const saltBytes = Buffer.from(`
% e2e ${run} ${salt}
`);
  files = {
    png: put(NAME.png, makePatternPng(800, 600, 0, salt)),
    png2: put(NAME.png2, makePatternPng(400, 300, 3, salt + 1)),
    mp4: put(NAME.mp4, Buffer.concat([fs.readFileSync(base.mp4Path), saltBytes])),
    pdf: put(NAME.pdf, Buffer.concat([fs.readFileSync(base.pdfPath), saltBytes])),
    docx: put(NAME.docx, Buffer.concat([fs.readFileSync(base.docxPath), saltBytes])),
    svg: base.svgPath,
    bigJpg: base.oversizedJpgPath,
    bigMp4: base.oversizedMp4Path,
  };
});

async function signIn(page: Page) {
  await page.goto(`${ADMIN}/`);
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Online Store" })).toBeVisible();
}

async function rpc<T>(page: Page, procedure: string, input: unknown): Promise<T> {
  const res = await page.request.post(`${API}/api/rpc/admin/${procedure}`, {
    data: { json: input },
    headers: { origin: ADMIN, "x-store-id": STORE_ID, "content-type": "application/json" },
  });
  expect(res.ok(), `${procedure} failed: ${res.status()} ${await res.text()}`).toBe(true);
  return ((await res.json()) as { json: T }).json;
}

async function mediaByName(page: Page, filename: string): Promise<MediaRow | undefined> {
  const list = await rpc<{ items: MediaRow[] }>(page, "media/list", { q: filename, limit: 20 });
  return list.items.find((m) => m.filename === filename);
}

async function waitForMedia(page: Page, filename: string, until: (m: MediaRow) => boolean = () => true): Promise<MediaRow> {
  let found: MediaRow | undefined;
  await expect
    .poll(
      async () => {
        found = await mediaByName(page, filename);
        return found ? until(found) : false;
      },
      { timeout: 60_000, intervals: [500, 1000, 2000], message: `media "${filename}" did not reach the expected state` },
    )
    .toBe(true);
  return found as MediaRow;
}

async function openMedia(page: Page, query = "") {
  await page.goto(`${ADMIN}/online-store/media${query}`);
  if (query.includes("selectedId")) {
    // An open detail sheet is modal: the page behind it (and its heading) is hidden from assistive technology
    await expect(page.getByRole("dialog")).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "Media", exact: true }).first()).toBeVisible();
  }
}

function chooseFiles(page: Page, paths: string[]) {
  return page.locator('input[type="file"]').first().setInputFiles(paths);
}

/** GET a path from the storefront by store host (used for files; pages are checked in a real browser). */
async function storefrontGet(pathname: string): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const ctx = await pwRequest.newContext();
  try {
    const res = await ctx.get(`${API}${pathname}`, { headers: { host: STORE_HOST } });
    return { status: res.status(), headers: res.headers(), body: await res.body() };
  } finally {
    await ctx.dispose();
  }
}

test.describe("Media library, real stack", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("refuses SVG, a 6 MB image and an 11 MB video with the specific reason", async ({ page }) => {
    await openMedia(page);
    // The page checks sizes against the plan limits it has loaded; wait for them (the storage meter shows them)
    await expect(page.getByText(/^Storage/).first()).toBeVisible();

    await chooseFiles(page, [files.svg]);
    await expect(page.getByText("SVG files are not supported for security reasons.")).toBeVisible();

    await chooseFiles(page, [files.bigJpg]);
    await expect(page.getByText(/Images can be up to 5 MB on your plan\. This file is 6\.\d MB\./)).toBeVisible();

    await chooseFiles(page, [files.bigMp4]);
    await expect(page.getByText(/Videos can be up to 10 MB on your plan\. This file is 11\.\d MB\./)).toBeVisible();

    // Nothing was stored for any of them
    expect(await mediaByName(page, path.basename(files.svg))).toBeUndefined();
    expect(await mediaByName(page, path.basename(files.bigJpg))).toBeUndefined();
    expect(await mediaByName(page, path.basename(files.bigMp4))).toBeUndefined();
  });

  test("uploads an image, a video, a PDF and a DOCX; previews load and the worker derives responsive images", async ({ page }) => {
    await openMedia(page);
    await chooseFiles(page, [files.png, files.mp4, files.pdf, files.docx]);

    const png = await waitForMedia(page, NAME.png);
    const pdf = await waitForMedia(page, NAME.pdf);
    const mp4 = await waitForMedia(page, NAME.mp4);
    const docx = await waitForMedia(page, NAME.docx);
    ids.png = png.id;
    ids.pdf = pdf.id;
    expect([png.kind, mp4.kind, pdf.kind, docx.kind]).toEqual(["image", "video", "document", "document"]);
    expect(png.width).toBe(800);
    expect(png.height).toBe(600);

    // The worker (not the web request) generated derived files: proves sharp runs in the worker image
    const withDerivatives = await waitForMedia(page, NAME.png, (m) => !!m.derivatives && Object.keys(m.derivatives).length > 0);
    const keys = Object.values(withDerivatives.derivatives ?? {}).map((d) => d.key);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys.every((k) => k.includes("/_derived/"))).toBe(true);

    // The grid shows all four, and the image tile really loads a picture
    await openMedia(page);
    const grid = page.getByRole("grid", { name: "Media library grid" });
    for (const n of Object.values([NAME.png, NAME.mp4, NAME.pdf, NAME.docx])) {
      await expect(grid.getByText(n).first()).toBeVisible();
    }
    const fileId = (png.storageKey ?? png.url).split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    expect(fileId.length).toBeGreaterThan(8);
    await expect
      .poll(async () =>
        page.locator("img").evaluateAll(
          (imgs, id) => imgs.filter((i) => (i as HTMLImageElement).src.includes(id as string)).map((i) => (i as HTMLImageElement).naturalWidth),
          fileId,
        ),
      )
      .toContainEqual(expect.any(Number));
    const widths = await page.locator("img").evaluateAll(
      (imgs, id) => imgs.filter((i) => (i as HTMLImageElement).src.includes(id as string)).map((i) => (i as HTMLImageElement).naturalWidth),
      fileId,
    );
    expect(widths.length).toBeGreaterThan(0);
    expect(Math.min(...widths)).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath("01-media-grid-desktop.png"), fullPage: true });
  });

  test("a file already in the library is flagged; 'Use existing' adds nothing, 'Upload anyway' adds a copy", async ({ page }) => {
    await openMedia(page);
    const dupe = path.join(path.dirname(files.png), `e2e${run}-copy-of-pattern.png`);
    fs.copyFileSync(files.png, dupe);

    await chooseFiles(page, [dupe]);
    await expect(page.getByText("Already in your library").or(page.getByText("Already in library")).first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("02a-duplicate-detected.png") });
    await page.getByRole("button", { name: "Use existing" }).first().click();
    expect(await mediaByName(page, `e2e${run}-copy-of-pattern.png`)).toBeUndefined();

    await chooseFiles(page, [dupe]);
    // A toast from the previous step can sit over this button, and the mouse resting on it keeps it open (it pauses
    // while hovered), so a pointer click is intercepted forever on small runners. Dispatch the click on the button.
    await page.getByRole("button", { name: "Upload anyway" }).first().dispatchEvent("click");
    const copy = await waitForMedia(page, `e2e${run}-copy-of-pattern.png`);
    expect(copy.id).not.toBe(ids.png);
    // The worker hashes it, and both files now share the same hash
    await expect
      .poll(async () => (await rpc<{ sha256: string | null }>(page, "media/get", { id: copy.id })).sha256, { timeout: 60_000 })
      .toBe((await rpc<{ sha256: string | null }>(page, "media/get", { id: ids.png })).sha256);
  });

  test("table view and filters: the choice survives a reload, search narrows the list", async ({ page }) => {
    await openMedia(page);
    await page.getByRole("button", { name: "Table view" }).click();
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator("table").getByText(NAME.png)).toBeVisible();

    await page.reload();
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator("table").getByText(NAME.pdf)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("02-media-table-desktop.png"), fullPage: true });

    await page.getByPlaceholder("Search filename or title...").fill(`e2e${run}-pattern`);
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(page.locator("table").getByText(NAME.png)).toBeVisible();
    await page.getByPlaceholder("Search filename or title...").fill("");

    await page.getByRole("button", { name: "Docs", exact: true }).click();
    await expect(page.locator("table").getByText(NAME.pdf)).toBeVisible();
    await expect(page.locator("table").getByText(NAME.docx)).toBeVisible();
    await expect(page.locator("table").getByText(NAME.png)).toHaveCount(0);

    await page.getByRole("button", { name: "Grid view" }).click();
    await expect(page.getByRole("grid", { name: "Media library grid" })).toBeVisible();
  });

  test("detail sheet: title, alt, caption and focal point persist", async ({ page }) => {
    expect(ids.png).toBeTruthy();
    await openMedia(page, `?selectedId=${ids.png}`);

    const title = `Pattern ${run}`;
    const alt = `Gradient test image ${run}`;
    await page.getByPlaceholder("Descriptive title").fill(title);
    await page.getByPlaceholder("Describe the image content and purpose").fill(alt);
    await page.getByPlaceholder("Optional caption displayed under the media").fill(`Caption ${run}`);

    const preview = page.locator(".cursor-crosshair").first();
    await expect(preview).toBeVisible();
    const box = await preview.boundingBox();
    expect(box).not.toBeNull();
    await preview.click({ position: { x: (box?.width ?? 100) * 0.3, y: (box?.height ?? 100) * 0.4 } });
    await expect(page.getByRole("button", { name: /Focal point marker/ })).toBeVisible();

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Media details updated")).toBeVisible();

    const saved = await rpc<MediaRow>(page, "media/get", { id: ids.png });
    expect(saved.title).toBe(title);
    expect(saved.alt).toBe(alt);
    expect(saved.focalX).toBeGreaterThan(0.2);
    expect(saved.focalX).toBeLessThan(0.4);
    expect(saved.focalY).toBeGreaterThan(0.3);
    expect(saved.focalY).toBeLessThan(0.5);

    await page.reload();
    await expect(page.getByPlaceholder("Descriptive title")).toHaveValue(title);
    await expect(page.getByPlaceholder("Describe the image content and purpose")).toHaveValue(alt);
    await expect(page.getByRole("button", { name: /Focal point marker/ })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("03-detail-sheet.png") });
  });

  test("a document downloads as an attachment from the storefront origin", async () => {
    expect(ids.pdf).toBeTruthy();
    const res = await storefrontGet(`/media/${ids.pdf}/download`);
    expect(res.status).toBe(200);
    const disposition = res.headers["content-disposition"] ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(NAME.pdf);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body.subarray(0, 4).toString()).toBe("%PDF");

    // An unknown id is a plain 404, not an error page or someone else's file
    const missing = await storefrontGet(`/media/00000000-0000-4000-8000-000000000000/download`);
    expect(missing.status).toBe(404);
  });

  test("product gallery: pick from the library, storefront shows responsive images, the file is protected while used", async ({ page }) => {
    expect(ids.png).toBeTruthy();
    const category = await rpc<{ id: string }>(page, "categories/create", { name: `E2E Category ${run}` });
    ids.productTitle = `E2E Product ${run}`;
    const product = await rpc<{ id: string; slug: string }>(page, "products/create", {
      title: ids.productTitle,
      status: "active",
      primaryCategoryId: category.id,
      variants: [{ sku: `E2E-${run}`.toUpperCase(), title: "Default", price: 49900 }],
    });
    ids.productId = product.id;
    ids.productSlug = product.slug;

    // Merchant adds the image through the shared picker
    await page.goto(`${ADMIN}/products/${product.id}`);
    await page.getByRole("button", { name: "Add media" }).first().click();
    const dialog = page.getByRole("dialog", { name: /Add media to product/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(`Select ${NAME.png}`).click();
    await dialog.getByRole("button", { name: /^Insert/ }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => (await rpc<{ media: unknown[] }>(page, "products/get", { id: product.id })).media.length, { timeout: 30_000 })
      .toBe(1);

    // A real browser on the storefront: the gallery image comes from the worker's derived files, and it loads
    const shop = await page.context().newPage();
    await shop.setViewportSize({ width: 1280, height: 900 });
    await expect
      .poll(
        async () => {
          await shop.goto(`${STORE_URL}/products/${product.slug}`);
          return shop.locator('img[srcset*="/_derived/"]').count();
        },
        { timeout: 60_000, intervals: [1000, 2000, 3000], message: "storefront product page never showed derived responsive images" },
      )
      .toBeGreaterThan(0);
    const galleryImg = shop.locator('img[srcset*="/_derived/"]').first();
    await expect(galleryImg).toBeVisible();
    await expect
      .poll(() => galleryImg.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), { timeout: 30_000 })
      .toBeGreaterThan(0);
    // It is not the original: the browser picked a resized file whose width is far below the 800 px original
    const srcset = (await galleryImg.getAttribute("srcset")) ?? "";
    expect(srcset).toMatch(/w320\.webp 320w/);
    await shop.screenshot({ path: test.info().outputPath("04a-storefront-product.png") });
    // Media shows where it is used
    await openMedia(page, `?selectedId=${ids.png}`);
    await expect(page.getByRole("heading", { name: "Used in" })).toBeVisible();
    await expect(page.getByText(ids.productTitle ?? "").first()).toBeVisible();

    // Used files can go to Trash, but cannot be deleted permanently: the message names the product
    await page.getByRole("button", { name: "Move to Trash" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page.getByText("Moved to Trash")).toBeVisible();
    // The confirmation closes by itself once the merchant confirms
    await expect(page.getByRole("dialog").getByRole("button", { name: "Move to Trash" })).toBeHidden();

    await openMedia(page, `?trash=true&selectedId=${ids.png}`);
    await page.getByRole("button", { name: "Delete permanently" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.getByText(new RegExp(`Cannot permanently delete: this file is still used in .*${ids.productTitle}`))).toBeVisible();
    // The confirmation closes (it stayed open before) so the result is readable
    await expect(page.getByText("Permanently delete this file and remove its storage object?")).toBeHidden();
    await page.screenshot({ path: test.info().outputPath("04-delete-blocked-names-product.png") });
    expect((await rpc<MediaRow>(page, "media/get", { id: ids.png })).status).toBe("trashed");

    // Restore it for the next test
    await page.getByRole("button", { name: "Restore" }).first().click();
    await expect(page.getByText("Restored from Trash")).toBeVisible();
  });

  test("replace keeps the file's identity, updates the storefront and removes the old files", async ({ page }) => {
    expect(ids.png && ids.productSlug).toBeTruthy();
    const before = await rpc<MediaRow>(page, "media/get", { id: ids.png });
    const oldKeys = Object.values(before.derivatives ?? {}).map((d) => d.key);
    expect(oldKeys.length).toBeGreaterThan(0);
    const oldUrl = new URL(before.url, API).toString();

    await openMedia(page, `?selectedId=${ids.png}`);
    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(files.png2);
    await expect(page.getByText("File replaced successfully")).toBeVisible();

    const after = await rpc<MediaRow>(page, "media/get", { id: ids.png });
    expect(after.id).toBe(ids.png);
    expect(after.width).toBe(400);
    expect(after.height).toBe(300);

    // New derived files (different keys) appear; the old ones are purged by the worker
    const fresh = await waitForMedia(page, NAME.png2, (m) => !!m.derivatives && Object.keys(m.derivatives).length > 0).catch(() => undefined);
    const current = fresh ?? (await waitForMedia(page, NAME.png, (m) => !!m.derivatives && Object.keys(m.derivatives).length > 0));
    const newKeys = Object.values(current.derivatives ?? {}).map((d) => d.key);
    expect(newKeys.length).toBeGreaterThan(0);
    for (const key of newKeys) expect(oldKeys).not.toContain(key);

    const gone = async (url: string) => (await (await pwRequest.newContext()).get(url)).status();
    await expect.poll(() => gone(oldUrl), { timeout: 60_000, intervals: [1000, 2000] }).toBe(404);
    await expect
      .poll(() => gone(new URL(`/media/${oldKeys[0]}`, API).toString()), { timeout: 60_000, intervals: [1000, 2000] })
      .toBe(404);

    // The storefront (real browser) now shows the new derived file, not the old one
    const shop = await page.context().newPage();
    await shop.setViewportSize({ width: 1280, height: 900 });
    await expect
      .poll(
        async () => {
          await shop.goto(`${STORE_URL}/products/${ids.productSlug}`);
          const sets = await shop.locator("img[srcset]").evaluateAll((els) => els.map((e) => e.getAttribute("srcset") ?? ""));
          const all = sets.join(" ");
          return all.includes(newKeys[0] as string) && !all.includes(oldKeys[0] as string);
        },
        { timeout: 60_000, intervals: [1000, 2000, 3000], message: "storefront still served the replaced image" },
      )
      .toBe(true);
    await shop.screenshot({ path: test.info().outputPath("06-storefront-after-replace.png") });
  });

  test("bulk Move to Trash and Delete permanently close their confirmation and show the result", async ({ page }) => {
    const name = `e2e${run}-bulk.docx`;
    const bulkFile = path.join(path.dirname(files.docx), name);
    fs.writeFileSync(bulkFile, Buffer.concat([fs.readFileSync(files.docx), Buffer.from(`
% bulk ${run} ${Math.random()}
`)]));
    await openMedia(page);
    await chooseFiles(page, [bulkFile]);
    await waitForMedia(page, name);

    await page.getByLabel(`Select ${name}`).first().check({ force: true });
    await page.getByRole("button", { name: "Move to Trash" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Move to Trash" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("Moved 1 file to Trash")).toBeVisible();

    await openMedia(page, "?trash=true");
    await page.getByLabel(`Select ${name}`).first().check({ force: true });
    await page.getByRole("button", { name: "Delete permanently" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("Permanently deleted 1 file")).toBeVisible();
    await expect(page.getByLabel(`Select ${name}`)).toHaveCount(0);
  });

  test("at 375 px the library is usable and previews load", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openMedia(page);
    await expect(page.getByRole("button", { name: "Upload files" }).first()).toBeVisible();
    const grid = page.getByRole("grid", { name: "Media library grid" });
    await expect(grid.getByText(NAME.pdf).first()).toBeVisible();
    const noHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noHorizontalScroll).toBe(true);
    await page.screenshot({ path: test.info().outputPath("05-media-mobile-375px.png"), fullPage: true });
  });
});
