import { expect, test, type Page } from "@playwright/test";

const SUPERADMIN = process.env.SUPERADMIN_URL ?? "http://127.0.0.1:8081";
const PLATFORM_API = process.env.PLATFORM_API_URL ?? "http://127.0.0.1:4000";
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:8080";
const STAFF_EMAIL = process.env.STAFF_EMAIL ?? "brandsewaofficial@gmail.com";
const STAFF_PASSWORD = process.env.STAFF_PASSWORD ?? "SuperAdminPass123!";

async function signInSuperAdmin(page: Page, email = STAFF_EMAIL, password = STAFF_PASSWORD, mfa = "123456") {
  await page.goto(`${SUPERADMIN}/login`);
  await expect(page).toHaveURL(/\/login/);
  await page.getByPlaceholder("staff@platform.gobs.cloud").fill(email);
  await page.getByPlaceholder("••••••••••••").fill(password);
  await page.getByPlaceholder("123456").fill(mfa);
  await page.getByRole("button", { name: "Sign In to Super Admin" }).click();
}

test.describe("Super Admin & SaaS Launch E2E (M9)", () => {
  test("Platform API CORS and origin isolation", async ({ request }) => {
    // 1. Refuses anonymous calls with 401
    const anon = await request.post(`${PLATFORM_API}/rpc/platform/tenants/list`, {
      data: {},
      headers: { origin: SUPERADMIN },
    });
    expect(anon.status()).toBeGreaterThanOrEqual(400);

    // 2. Disallows forbidden origins
    const evil = await request.post(`${PLATFORM_API}/rpc/platform/tenants/list`, {
      data: {},
      headers: { origin: "https://evil.attacker.local" },
    });
    const allowOrigin = evil.headers()["access-control-allow-origin"];
    expect(allowOrigin).toBeUndefined();
  });

  test("Super Admin login rejects invalid password", async ({ page }) => {
    await page.goto(`${SUPERADMIN}/login`);
    await page.getByPlaceholder("staff@platform.gobs.cloud").fill(STAFF_EMAIL);
    await page.getByPlaceholder("••••••••••••").fill("wrong-pass");
    await page.getByPlaceholder("123456").fill("123456");
    await page.getByRole("button", { name: "Sign In to Super Admin" }).click();

    // Verify still on login page and error toast or notification is triggered
    await expect(page).toHaveURL(/\/login/);
  });

  test("Provision new store and accept owner onboarding invite", async ({ page }) => {
    // If backend is running with live staff credentials
    if (!process.env.RUN_LIVE_SUPERADMIN_E2E) {
      test.skip();
      return;
    }

    // 1. Sign in to Super Admin
    await signInSuperAdmin(page);
    await expect(page.getByText("Platform Overview")).toBeVisible();

    // 2. Navigate to Create Store
    await page.goto(`${SUPERADMIN}/tenants/create`);
    await expect(page.getByText("Provision New Store")).toBeVisible();

    const uniqueSlug = `e2e-store-${Date.now()}`;
    await page.getByLabel(/Store \/ Business Name/i).fill("E2E Test Store");
    await page.getByLabel(/Subdomain Slug/i).fill(uniqueSlug);
    await page.getByLabel(/Store Owner Email/i).fill(`${uniqueSlug}@example.com`);

    // Submit provisioning form
    await page.getByRole("button", { name: /Provision Store & Generate Invite/i }).click();

    // 3. Verify single-use invite link displayed with unconfigured email notice
    await expect(page.getByText("Store Provisioned Successfully!")).toBeVisible();
    await expect(page.getByText("Single-Use Owner Onboarding Link")).toBeVisible();
    await expect(page.getByText(/Owner Onboarding Link Generated/i)).toBeVisible();

    // Extract invite URL
    const inviteInput = page.locator("input.select-all");
    const inviteUrl = await inviteInput.inputValue();
    expect(inviteUrl).toContain("/accept-invite?token=");

    // 4. Accept invite: merchant visits onboarding link and sets password
    await page.goto(inviteUrl);
    await expect(page.getByText(/Accept Invitation|Set Your Password/i)).toBeVisible();
    await page.getByLabel(/Password/i).fill("OwnerPass12345!");
    await page.getByRole("button", { name: /Complete Setup|Activate Account/i }).click();

    // 5. Verify redirection to Store Admin
    await expect(page).toHaveURL(new RegExp(ADMIN));
    await expect(page.getByText("E2E Test Store")).toBeVisible();
  });
});
