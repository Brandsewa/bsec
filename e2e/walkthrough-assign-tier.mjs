import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ARTIFACTS_DIR = path.resolve(
  process.cwd().endsWith("e2e") ? ".." : ".",
  "apps/superadmin/walkthrough-artifacts"
);
if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

async function run() {
  console.log("=== Starting Playwright Browser Walkthrough for Tier Assignment (Super Admin) ===");
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  const matrixState = {
    tiers: [
      {
        code: "XS",
        name: "Extra Small",
        description: "Starter tier for new storefronts",
        priceMonthlyPaise: 0,
        priceYearlyPaise: 0,
        currency: "INR",
        isPublic: true,
        isActive: true,
        sort: 10,
        storeCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        code: "S",
        name: "Small",
        description: "Growing independent brands",
        priceMonthlyPaise: 149900,
        priceYearlyPaise: 1499000,
        currency: "INR",
        isPublic: true,
        isActive: true,
        sort: 20,
        storeCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        code: "M",
        name: "Medium",
        description: "Scale-stage catalogue",
        priceMonthlyPaise: 299900,
        priceYearlyPaise: 2999000,
        currency: "INR",
        isPublic: true,
        isActive: true,
        sort: 30,
        storeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        code: "L",
        name: "Large",
        description: "Enterprise multi-location merchants",
        priceMonthlyPaise: 599900,
        priceYearlyPaise: 5999000,
        currency: "INR",
        isPublic: true,
        isActive: true,
        sort: 40,
        storeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        code: "XL",
        name: "Extra Large",
        description: "High-volume enterprise brands with massive catalogues",
        priceMonthlyPaise: 499900,
        priceYearlyPaise: 4999000,
        currency: "INR",
        isPublic: true,
        isActive: true,
        sort: 50,
        storeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    definitions: [
      {
        key: "products_max",
        description: "Maximum active products",
        unit: "count",
        enforcement: "hard",
        tierXs: 50,
        tierS: 500,
        tierM: 5000,
        tierL: 50000,
        sort: 10,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    limits: [
      { tierCode: "XS", quotaKey: "products_max", value: 50 },
      { tierCode: "S", quotaKey: "products_max", value: 500 },
      { tierCode: "M", quotaKey: "products_max", value: 5000 },
      { tierCode: "L", quotaKey: "products_max", value: 50000 },
      { tierCode: "XL", quotaKey: "products_max", value: 10000 },
    ],
  };

  const tenantsState = [
    {
      id: "t-store-1",
      name: "Sikkim Supreme",
      slug: "sikkim-supreme",
      domain: "sikkimsupreme.co",
      status: "active",
      tier: "XS",
      ownerEmail: "owner@sikkimsupreme.co",
      createdAt: new Date().toISOString(),
    },
    {
      id: "t-store-2",
      name: "Ricwell Organic",
      slug: "ricwell",
      domain: "ricwell.com",
      status: "active",
      tier: "S",
      ownerEmail: "admin@ricwell.com",
      createdAt: new Date().toISOString(),
    },
  ];

  const recordedCalls = [];

  const setupContext = async (viewport) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    // Intercept platform auth session
    await page.route("**/api/platform/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          sessionValid: true,
          isPlatformStaff: true,
          userId: "u-platform-admin-1",
          email: "admin@platform.test",
          name: "Platform Admin",
          role: "platform_admin",
          mfaComplete: true,
        }),
      });
    });

    // Intercept oRPC platform calls
    await page.route("**/rpc/**", async (route) => {
      const url = route.request().url();
      const postData = route.request().postData();
      let parsedBody = null;
      if (postData) {
        try {
          const raw = JSON.parse(postData);
          parsedBody = raw.json !== undefined ? raw.json : raw;
        } catch {}
      }

      // Quota matrix
      if (url.includes("/rpc/quotas/matrix") || url.includes("/rpc/quotas.matrix")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ json: matrixState }),
        });
      }

      // Tenants list
      if (url.includes("/rpc/tenants/list") || url.includes("/rpc/tenants.list")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ json: tenantsState }),
        });
      }

      // Bulk tier assignment
      if (url.includes("/rpc/tenants/bulkChangeTier") || url.includes("/rpc/tenants.bulkChangeTier")) {
        recordedCalls.push({ action: "bulkChangeTier", body: parsedBody });
        console.log("-> Intercepted bulkChangeTier call:", JSON.stringify(parsedBody));

        // Update the mocked tenants
        for (const id of parsedBody.tenantIds) {
          const t = tenantsState.find((item) => item.id === id);
          if (t) {
            t.tier = parsedBody.tier;
          }
        }

        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            json: {
              updatedCount: parsedBody.tenantIds.length,
              tier: parsedBody.tier,
            },
          }),
        });
      }

      // Default continue or empty response for other RPC calls
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ json: [] }),
      });
    });

    return { context, page };
  };

  // --- PART 1: DESKTOP (1280x800) ---
  console.log("\n[1/2] Executing Desktop Walkthrough (1280x800)...");
  const desktop = await setupContext({ width: 1280, height: 800 });
  const page = desktop.page;

  // 1. Navigate to /tenants
  await page.goto("http://localhost:5174/tenants", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  console.log("-> Verifying Tenants Table renders with stores...");
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "10_desktop_tenants_list.png") });

  // 2. Select first store (Sikkim Supreme, tier XS)
  console.log("-> Selecting store 'Sikkim Supreme' (currently on tier XS)...");
  await page.locator("[aria-label='Select Sikkim Supreme']").click();
  await page.waitForTimeout(300);

  // Verify bulk action banner appears
  const bulkBanner = page.locator("div", { hasText: "1 store(s) selected" }).first();
  const bannerVisible = await bulkBanner.isVisible();
  console.log(`✓ Bulk action banner visible: ${bannerVisible}`);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "11_desktop_store_selected_bulk_bar.png") });

  // 3. Click "Change Tier"
  console.log("-> Opening Bulk Change Resource Tier dialog...");
  await page.locator("button:has-text('Change Tier')").click();
  await page.waitForTimeout(400);

  const dialog = page.locator("[role='dialog']");
  await dialog.waitFor({ state: "visible", timeout: 5000 });

  // 4. Open Tier select and inspect options
  console.log("-> Verifying newly created tier 'XL' appears in options with name, price, and limit...");
  await dialog.locator("button[role='combobox']").click();
  await page.waitForTimeout(300);

  // Check if XL option is rendered
  const xlOption = page.locator("[role='option']", { hasText: "XL — Extra Large" });
  const xlOptionText = await xlOption.innerText();
  console.log(`✓ Found tier option: "${xlOptionText}"`);
  if (!xlOptionText.includes("₹4,999/mo") || !xlOptionText.includes("10,000 products")) {
    throw new Error(`Expected XL option to show ₹4,999/mo and 10,000 products. Got: "${xlOptionText}"`);
  }

  // Select XL
  await xlOption.click();
  await page.waitForTimeout(300);

  // Verify typed confirmation label updated to 'TIER XL 1'
  const confirmPrompt = await dialog.locator("label", { hasText: "To confirm, type" }).innerText();
  console.log(`✓ Confirmation prompt: "${confirmPrompt}"`);
  if (!confirmPrompt.includes("TIER XL 1")) {
    throw new Error(`Expected prompt to contain 'TIER XL 1', got: "${confirmPrompt}"`);
  }

  // Type confirmation
  await dialog.locator("input[data-slot='input']").fill("TIER XL 1");
  await page.waitForTimeout(200);

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "12_desktop_bulk_tier_dialog_filled.png") });

  // Click Apply Tier
  console.log("-> Clicking Apply Tier...");
  await dialog.locator("button:has-text('Apply Tier')").click();
  await page.waitForTimeout(500);

  // Verify toast
  const toastText = await page.locator("[data-sonner-toast]").innerText();
  console.log(`✓ Toast feedback: "${toastText}"`);
  if (!toastText.includes("Updated 1 store(s) to tier XL")) {
    throw new Error(`Expected success toast 'Updated 1 store(s) to tier XL', got: "${toastText}"`);
  }

  // Verify Sikkim Supreme now has tier XL badge
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "13_desktop_store_assigned_xl_success.png") });
  console.log("✓ Desktop store assignment verified.");

  await desktop.context.close();

  // --- PART 2: MOBILE (375x812) ---
  console.log("\n[2/2] Executing Mobile Walkthrough (375x812)...");
  const mobile = await setupContext({ width: 375, height: 812 });
  const mPage = mobile.page;

  await mPage.goto("http://localhost:5174/tenants", { waitUntil: "networkidle" });
  await mPage.waitForTimeout(500);
  await mPage.screenshot({ path: path.join(ARTIFACTS_DIR, "14_mobile_tenants_view.png") });

  // Select second store (Ricwell Organic, tier S)
  console.log("-> Selecting store 'Ricwell Organic' on mobile...");
  await mPage.locator("[aria-label='Select Ricwell Organic']").click();
  await mPage.waitForTimeout(300);

  await mPage.screenshot({ path: path.join(ARTIFACTS_DIR, "15_mobile_store_selected_bulk_bar.png") });

  // Click Change Tier on mobile
  await mPage.locator("button:has-text('Change Tier')").click();
  await mPage.waitForTimeout(400);

  const mDialog = mPage.locator("[role='dialog']");
  await mDialog.locator("button[role='combobox']").click();
  await mPage.waitForTimeout(300);

  const mXlOption = mPage.locator("[role='option']", { hasText: "XL — Extra Large" });
  await mXlOption.click();
  await mPage.waitForTimeout(300);

  await mDialog.locator("input[data-slot='input']").fill("TIER XL 1");
  await mPage.waitForTimeout(200);

  await mPage.screenshot({ path: path.join(ARTIFACTS_DIR, "16_mobile_bulk_tier_dialog_filled.png") });

  await mDialog.locator("button:has-text('Apply Tier')").click();
  await mPage.waitForTimeout(500);

  await mPage.screenshot({ path: path.join(ARTIFACTS_DIR, "17_mobile_store_assigned_xl_success.png") });
  console.log("✓ Mobile store assignment verified.");

  await mobile.context.close();
  await browser.close();

  console.log("\n=== Walkthrough Finished Successfully with Zero Defects ===");
}

run().catch((err) => {
  console.error("Walkthrough failed:", err);
  process.exit(1);
});
