import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ARTIFACTS_DIR = path.resolve(
  process.cwd().endsWith("e2e") ? ".." : ".",
  "apps/superadmin/walkthrough-artifacts"
);
if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

async function run() {
  console.log("=== Starting Playwright Browser Walkthrough for Integrations Hub & Channels ===");

  // Start Vite preview on port 5174
  const previewProcess = spawn("pnpm", ["--filter", "@bs/superadmin", "preview"], {
    shell: true,
    stdio: "pipe",
  });

  previewProcess.stdout.on("data", (data) => {
    // console.log(`[vite preview] ${data}`);
  });
  previewProcess.stderr.on("data", (data) => {
    // console.error(`[vite preview err] ${data}`);
  });

  // Wait for port 5174 to become available
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch("http://localhost:5174");
      if (res.ok || res.status === 200 || res.status === 404) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!ready) {
    console.error("Failed to start preview server on port 5174");
    previewProcess.kill();
    process.exit(1);
  }
  console.log("-> Vite preview server ready on http://localhost:5174");

  const browser = await chromium.launch({ channel: "chrome", headless: true });

  const mockOverview = {
    channels: {
      email: {
        status: "active",
        sent7d: 1420,
        failed7d: 12,
        provider: "zeptomail",
      },
      sms: {
        status: "not_enrolled",
        sent7d: 0,
        failed7d: 0,
        provider: "zoho_cpaas",
      },
      whatsapp: {
        status: "not_enrolled",
        sent7d: 0,
        failed7d: 0,
        provider: "zoho_cpaas",
      },
    },
    storage: {
      activeConnections: 2,
      totalBytes: 15485760000,
      totalFiles: 3420,
    },
    payments: {
      enabledProviders: ["razorpay", "stripe"],
      totalConnectedStores: 14,
    },
  };

  const mockStats = {
    channel: "email",
    range: "7d",
    sent: 1408,
    failed: 12,
    skipped: 0,
    total: 1420,
    successRate: 99.1,
    daily: [
      { date: "2026-10-02", sent: 180, failed: 2, skipped: 0 },
      { date: "2026-10-03", sent: 210, failed: 1, skipped: 0 },
      { date: "2026-10-04", sent: 195, failed: 0, skipped: 0 },
      { date: "2026-10-05", sent: 220, failed: 3, skipped: 0 },
      { date: "2026-10-06", sent: 205, failed: 1, skipped: 0 },
      { date: "2026-10-07", sent: 215, failed: 2, skipped: 0 },
      { date: "2026-10-08", sent: 195, failed: 3, skipped: 0 },
    ],
  };

  const mockTransactions = {
    items: [
      {
        id: "log-1",
        channel: "email",
        createdAt: "2026-10-08T14:20:00Z",
        recipient: "c***@example.com",
        template: "order_confirmation",
        tenantId: "t-sikkim",
        tenantName: "Sikkim Supreme",
        status: "sent",
        provider: "zeptomail",
        providerMessageId: "zmail_msg_982312",
        error: null,
      },
      {
        id: "log-2",
        channel: "email",
        createdAt: "2026-10-08T13:45:00Z",
        recipient: "a***@customer.in",
        template: "order_shipped",
        tenantId: "t-ricwell",
        tenantName: "Ricwell Organic",
        status: "sent",
        provider: "zeptomail",
        providerMessageId: "zmail_msg_982313",
        error: null,
      },
      {
        id: "log-3",
        channel: "email",
        createdAt: "2026-10-08T11:10:00Z",
        recipient: "k***@outlook.com",
        template: "abandoned_cart",
        tenantId: "t-sikkim",
        tenantName: "Sikkim Supreme",
        status: "failed",
        provider: "zeptomail",
        providerMessageId: null,
        error: "Mailbox inactive or bounced by remote MX (550 User Unknown)",
      },
    ],
    total: 3,
  };

  const mockStorageStats = {
    totalBytes: 15485760000,
    totalFiles: 3420,
    byConnection: [
      { connectionId: "conn-1", name: "Primary R2 Assets", driver: "cloudflare_r2", totalBytes: 14200000000, fileCount: 3100 },
      { connectionId: "conn-2", name: "Local Fallback Cache", driver: "local_disk", totalBytes: 1285760000, fileCount: 320 },
    ],
    topTenants: [
      { tenantId: "t-sikkim", name: "Sikkim Supreme", slug: "sikkim-supreme", totalBytes: 8900000000, fileCount: 1950 },
      { tenantId: "t-ricwell", name: "Ricwell Organic", slug: "ricwell", totalBytes: 6585760000, fileCount: 1470 },
    ],
  };

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
      if (url.includes("/rpc/integrations/overview") || url.includes("/rpc/integrations.overview")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ json: mockOverview }),
        });
      }
      if (url.includes("/rpc/integrations/channelStats") || url.includes("/rpc/integrations.channelStats")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ json: mockStats }),
        });
      }
      if (url.includes("/rpc/integrations/channelTransactions") || url.includes("/rpc/integrations.channelTransactions")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ json: mockTransactions }),
        });
      }
      if (url.includes("/rpc/storage/stats") || url.includes("/rpc/storage.stats")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ json: mockStorageStats }),
        });
      }
      if (url.includes("/rpc/storage/list") || url.includes("/rpc/storage.list")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            json: [
              {
                id: "conn-1",
                name: "Primary R2 Assets",
                driver: "cloudflare_r2",
                isDefault: true,
                isWritable: true,
                configMasked: { bucket: "brandsewa-assets", region: "auto" },
                storeCount: 14,
                createdAt: "2026-09-01T00:00:00Z",
              },
            ],
          }),
        });
      }
      if (url.includes("/rpc/storage/drivers") || url.includes("/rpc/storage.drivers")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            json: [
              { driver: "cloudflare_r2", name: "Cloudflare R2" },
              { driver: "local_disk", name: "Local Disk" },
            ],
          }),
        });
      }
      if (url.includes("/rpc/email/settings") || url.includes("/rpc/email.settings")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            json: {
              configured: true,
              fromAddress: "notifications@bcom.si",
              fromName: "BSEC Commerce Platform",
              tokenConfigured: true,
              apiUrl: "https://api.zeptomail.in/v1.1/email",
              updatedAt: "2026-10-01T00:00:00Z",
            },
          }),
        });
      }

      // Fallback
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ json: {} }),
      });
    });

    return { context, page };
  };

  try {
    // --- 1. DESKTOP WALKTHROUGH (1280x800) ---
    console.log("\n[1/2] Executing Desktop Walkthrough (1280x800)...");
    const desktop = await setupContext({ width: 1280, height: 800 });
    const page = desktop.page;

    // A. Hub shell /integrations
    console.log("-> Navigating to /integrations...");
    await page.goto("http://localhost:5174/integrations", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "20_desktop_integrations_hub.png") });

    // B. Command Palette check
    console.log("-> Testing Command Palette shortcut...");
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "21_desktop_command_palette.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // C. Notifications Hub /integrations/notifications
    console.log("-> Navigating to /integrations/notifications...");
    await page.goto("http://localhost:5174/integrations/notifications", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "22_desktop_notifications_hub.png") });

    // D. Email Channel /integrations/notifications/email
    console.log("-> Navigating to /integrations/notifications/email...");
    await page.goto("http://localhost:5174/integrations/notifications/email", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "23_desktop_email_channel_transactions.png") });

    // Open transaction detail drawer
    console.log("-> Clicking transaction log row to open drawer...");
    const row = page.getByText("order_confirmation").first();
    await row.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "24_desktop_email_transaction_drawer.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Switch to Providers tab
    console.log("-> Switching to Providers tab...");
    await page.getByRole("tab", { name: "Providers" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "25_desktop_email_providers_tab.png") });

    // Click configure on ZeptoMail to open Sheet
    console.log("-> Opening ZeptoMail configure sheet...");
    await page.getByRole("button", { name: "Configure" }).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "26_desktop_zeptomail_configure_sheet.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // E. Storage /integrations/storage
    console.log("-> Navigating to /integrations/storage...");
    await page.goto("http://localhost:5174/integrations/storage", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "27_desktop_storage_stats.png") });

    // F. Payments /integrations/payments
    console.log("-> Navigating to /integrations/payments...");
    await page.goto("http://localhost:5174/integrations/payments", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "28_desktop_payments_hub.png") });

    // G. Verify Redirects
    console.log("-> Verifying /email redirect...");
    await page.goto("http://localhost:5174/email", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const emailUrl = page.url();
    console.log(`   /email redirected to: ${emailUrl}`);
    if (!emailUrl.includes("/integrations/notifications/email")) {
      throw new Error(`Expected redirect to /integrations/notifications/email, got: ${emailUrl}`);
    }

    console.log("-> Verifying /storage redirect...");
    await page.goto("http://localhost:5174/storage", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const storageUrl = page.url();
    console.log(`   /storage redirected to: ${storageUrl}`);
    if (!storageUrl.includes("/integrations/storage")) {
      throw new Error(`Expected redirect to /integrations/storage, got: ${storageUrl}`);
    }

    await desktop.context.close();

    // --- 2. MOBILE WALKTHROUGH (375x812) ---
    console.log("\n[2/2] Executing Mobile Walkthrough (375x812)...");
    const mobile = await setupContext({ width: 375, height: 812 });
    const mPage = mobile.page;

    console.log("-> Navigating to /integrations (mobile)...");
    await mPage.goto("http://localhost:5174/integrations", { waitUntil: "networkidle" });
    await mPage.waitForTimeout(500);
    await mPage.screenshot({ path: path.join(ARTIFACTS_DIR, "30_mobile_integrations_hub.png") });

    console.log("-> Navigating to /integrations/notifications (mobile)...");
    await mPage.goto("http://localhost:5174/integrations/notifications", { waitUntil: "networkidle" });
    await mPage.waitForTimeout(500);
    await mPage.screenshot({ path: path.join(ARTIFACTS_DIR, "31_mobile_notifications_hub.png") });

    console.log("-> Navigating to /integrations/notifications/email (mobile)...");
    await mPage.goto("http://localhost:5174/integrations/notifications/email", { waitUntil: "networkidle" });
    await mPage.waitForTimeout(500);
    await mPage.screenshot({ path: path.join(ARTIFACTS_DIR, "32_mobile_email_channel.png") });

    console.log("-> Navigating to /integrations/storage (mobile)...");
    await mPage.goto("http://localhost:5174/integrations/storage", { waitUntil: "networkidle" });
    await mPage.waitForTimeout(500);
    await mPage.screenshot({ path: path.join(ARTIFACTS_DIR, "33_mobile_storage.png") });

    console.log("-> Navigating to /integrations/payments (mobile)...");
    await mPage.goto("http://localhost:5174/integrations/payments", { waitUntil: "networkidle" });
    await mPage.waitForTimeout(500);
    await mPage.screenshot({ path: path.join(ARTIFACTS_DIR, "34_mobile_payments.png") });

    await mobile.context.close();

    console.log("\n=== Walkthrough completed successfully! All screenshots captured. ===");
  } finally {
    await browser.close();
    previewProcess.kill();
  }
}

run().catch((err) => {
  console.error("Walkthrough failed:", err);
  process.exit(1);
});
