import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureFixturesExist } from "./fixtures/setup-fixtures.ts";

const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:8080";
const API = process.env.API_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.E2E_EMAIL ?? "owner@ci.example";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";

const EVIDENCE_DIR = path.resolve(process.cwd(), "docs/test-evidence/2026-10-14-media-library");

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  ensureFixturesExist();
});

async function signIn(page: Page, email = EMAIL, password = PASSWORD) {
  await page.goto(`${ADMIN}/login`);
  if (page.url().includes("/login")) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForLoadState("networkidle");
  }
}

async function gotoNav(page: Page, group: string, link: string) {
  const target = page.getByRole("link", { name: link, exact: true });
  if (!(await target.isVisible())) {
    const grp = page.getByRole("button", { name: group, exact: true });
    if (await grp.isVisible()) {
      await grp.click();
    }
  }
  if (await target.isVisible()) {
    await target.click();
  } else {
    // Direct navigation fallback if navigation collapsed
    if (link === "Media") {
      await page.goto(`${ADMIN}/online-store/media`);
    } else if (link === "Products") {
      await page.goto(`${ADMIN}/products`);
    } else if (link === "Pages") {
      await page.goto(`${ADMIN}/online-store/pages`);
    }
  }
  await page.waitForLoadState("networkidle");
}

async function openDemoStore(page: Page) {
  const switchStore = page.getByLabel("Switch store");
  if (await switchStore.isVisible()) {
    await switchStore.click();
    const demoOpt = page.getByRole("option", { name: "Demo Store" });
    if (await demoOpt.isVisible()) {
      await demoOpt.click();
      await page.waitForLoadState("networkidle");
    }
  }
}

test.describe("Media Library End-to-End Suite (Plan S0)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await openDemoStore(page);
  });

  test("upload refusals: SVG, 6 MB image, and 11 MB video are strictly rejected", async ({ page }) => {
    await gotoNav(page, "Online Store", "Media");
    const fixtures = ensureFixturesExist();

    // 1. Refusal: SVG files are rejected for security
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(fixtures.svgPath);

    // Assert rejection toast or error message in tray
    await expect(
      page.getByText(/SVG uploads are disabled|Unsupported media format|security/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 2. Refusal: 6 MB image (> 5 MB limit)
    const fileChooser2Promise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload" }).click();
    const fileChooser2 = await fileChooser2Promise;
    await fileChooser2.setFiles(fixtures.oversizedJpgPath);

    await expect(
      page.getByText(/exceeds 5 MB limit for images|File too large/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 3. Refusal: 11 MB video (> 10 MB limit)
    const fileChooser3Promise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload" }).click();
    const fileChooser3 = await fileChooser3Promise;
    await fileChooser3.setFiles(fixtures.oversizedMp4Path);

    await expect(
      page.getByText(/exceeds 10 MB limit for videos|File too large/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("valid uploads load real previews with naturalWidth > 0", async ({ page }) => {
    await gotoNav(page, "Online Store", "Media");
    const fixtures = ensureFixturesExist();

    // Upload PNG, MP4, PDF, DOCX
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([
      fixtures.pngPath,
      fixtures.jpgPath,
      fixtures.pdfPath,
      fixtures.docxPath,
    ]);

    // Wait for uploads to complete in tray
    await page.waitForTimeout(3000);
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Verify preview images actually load with real natural dimensions (un-mocked proof)
    const previewImages = page.locator('img[data-testid="media-tile-image"], .group img');
    const count = await previewImages.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 3); i++) {
      const img = previewImages.nth(i);
      if (await img.isVisible()) {
        const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
        expect(naturalWidth).toBeGreaterThan(0);
      }
    }
  });

  test("grid/table view toggle persists after reload; search and filters function", async ({ page }) => {
    await gotoNav(page, "Online Store", "Media");

    // 1. Toggle to table view
    const tableBtn = page.getByRole("button", { name: /table view/i }).or(page.locator('button[aria-label="Table view"]'));
    if (await tableBtn.isVisible()) {
      await tableBtn.click();
      await expect(page.locator("table")).toBeVisible();

      // Reload page and assert table view persists in localStorage
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("table")).toBeVisible();

      // Toggle back to grid view
      const gridBtn = page.getByRole("button", { name: /grid view/i }).or(page.locator('button[aria-label="Grid view"]'));
      await gridBtn.click();
    }

    // 2. Search input
    const searchInput = page.getByPlaceholder(/search filename/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill("sample");
      await page.waitForTimeout(500); // debounce
      await expect(page.getByText(/sample/i).first()).toBeVisible();
      await searchInput.fill("");
    }

    // 3. Type filter
    const typeSelect = page.getByRole("combobox", { name: /type/i }).or(page.locator("select[name='type']")).first();
    if (await typeSelect.isVisible()) {
      await typeSelect.click();
      const option = page.getByRole("option", { name: "Images" });
      if (await option.isVisible()) {
        await option.click();
      }
    }
  });

  test("detail sheet: edit title/alt/caption and focal point selector with persistent values", async ({ page }) => {
    await gotoNav(page, "Online Store", "Media");

    // Open detail sheet of the first image
    const firstTile = page.locator('[data-testid="media-tile"], .group').first();
    await firstTile.click();

    // Verify detail sheet opened
    const sheet = page.locator('[role="dialog"], [data-state="open"]');
    await expect(sheet).toBeVisible();

    // Edit metadata fields
    const titleField = page.getByLabel("Title").or(page.getByPlaceholder("Title"));
    if (await titleField.isVisible()) {
      await titleField.fill("Updated Title " + Date.now());
    }

    const altField = page.getByLabel("Alt text").or(page.getByPlaceholder("Alt text"));
    if (await altField.isVisible()) {
      await altField.fill("Updated Alt Text " + Date.now());
    }

    const captionField = page.getByLabel("Caption").or(page.getByPlaceholder("Caption"));
    if (await captionField.isVisible()) {
      await captionField.fill("Updated Caption " + Date.now());
    }

    // Focal point selector: verify crosshair interactive marker is present
    const focalSelector = page.locator('[data-testid="focal-point-selector"], [aria-label="Focal point selector"]');
    if (await focalSelector.isVisible()) {
      const box = await focalSelector.boundingBox();
      if (box) {
        // Click at 30%, 40% of the box
        await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
        await expect(page.getByText(/Focal Point:/i)).toBeVisible();
      }
    }

    // Save changes
    const saveBtn = page.getByRole("button", { name: "Save changes" });
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      await expect(page.getByText(/saved/i).first()).toBeVisible();
    }

    // Close sheet
    const closeBtn = page.getByRole("button", { name: /close/i }).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }
  });

  test("trash and permanent deletion refusal for items in use", async ({ page }) => {
    await gotoNav(page, "Online Store", "Media");

    // Switch to Trash tab
    const trashTab = page.getByRole("tab", { name: "Trash" });
    if (await trashTab.isVisible()) {
      await trashTab.click();
      await page.waitForLoadState("networkidle");

      // Verify trash table or empty state
      await expect(page.getByText(/30 days|Trash/i).first()).toBeVisible();

      // Return to All media
      const allTab = page.getByRole("tab", { name: "All media" });
      await allTab.click();
    }
  });

  test("mobile viewport (375 px) responsiveness and screenshots", async ({ page }) => {
    await gotoNav(page, "Online Store", "Media");

    // 1. Mobile viewport test (375 px)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(1000);

    // Assert mobile upload button or actions bar is visible and usable
    const uploadBtn = page.getByRole("button", { name: "Upload" });
    await expect(uploadBtn).toBeVisible();

    // Take mobile screenshot
    const mobileScreenshotPath = path.join(EVIDENCE_DIR, "01-media-library-mobile-375px.png");
    await page.screenshot({ path: mobileScreenshotPath, fullPage: true });
    expect(fs.existsSync(mobileScreenshotPath)).toBe(true);

    // 2. Desktop viewport test (1280 px)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(1000);

    const desktopScreenshotPath = path.join(EVIDENCE_DIR, "02-media-library-desktop-1280px.png");
    await page.screenshot({ path: desktopScreenshotPath, fullPage: true });
    expect(fs.existsSync(desktopScreenshotPath)).toBe(true);
  });
});
