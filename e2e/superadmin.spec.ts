import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/**
 * Super Admin end to end, through the real UI against a running stack (platform API + Super Admin SPA):
 * first sign-in -> authenticator setup -> sign-in again with a computed code -> create a store -> support session -> suspend/restore.
 *   SUPERADMIN_URL   the SPA          (default http://127.0.0.1:8081)
 *   PLATFORM_API_URL the platform API (default http://127.0.0.1:4000)
 *   STAFF_EMAIL / STAFF_PASSWORD  the bootstrap platform owner created with `node dist/create-staff.js`
 */
const SUPERADMIN = process.env.SUPERADMIN_URL ?? "http://127.0.0.1:8081";
const PLATFORM_API = process.env.PLATFORM_API_URL ?? "http://127.0.0.1:4000";
const STAFF_EMAIL = process.env.STAFF_EMAIL ?? "owner@ci.example";
const STAFF_PASSWORD = process.env.STAFF_PASSWORD ?? "ci-staff-password-123";

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits): what an authenticator app computes from the setup key. */
function totp(base32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  const code = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

async function fillCredentials(page: Page, password = STAFF_PASSWORD) {
  await page.goto(`${SUPERADMIN}/login`);
  await page.getByLabel("Platform Staff Email").fill(STAFF_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In with Credentials" }).click();
}

async function signInWithCode(page: Page, secret: string) {
  await fillCredentials(page);
  await page.getByLabel("Authenticator Code (6 digits)").fill(totp(secret));
  await page.getByRole("button", { name: "Verify & Complete Login" }).click();
  await expect(page.getByRole("heading", { name: "Platform Overview" })).toBeVisible();
}

test.describe.serial("Super Admin (M9)", () => {
  let secret = "";

  test("the platform API refuses anonymous calls and other origins", async ({ request }) => {
    const anon = await request.get(`${PLATFORM_API}/platform/tenants`);
    expect(anon.status()).toBe(401);
    const evil = await request.post(`${PLATFORM_API}/api/platform/mfa/complete`, { data: {}, headers: { origin: "https://evil-store.bcom.si" } });
    expect(evil.status()).toBe(403);
    expect(evil.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("an anonymous visitor is sent to the login page, and a wrong password is refused", async ({ page }) => {
    await page.goto(`${SUPERADMIN}/tenants`);
    await expect(page).toHaveURL(/\/login/);
    await fillCredentials(page, "definitely-the-wrong-password");
    await expect(page.getByRole("alert")).toContainText("Incorrect email or password");
    await expect(page).toHaveURL(/\/login/);
  });

  test("first sign-in forces authenticator setup, then the next sign-in needs a code", async ({ page }) => {
    await fillCredentials(page);
    // password alone does not get in: the setup step appears
    await expect(page.getByText("Platform accounts need two-factor authentication")).toBeVisible();
    await page.getByLabel("Confirm your password to generate your secret").fill(STAFF_PASSWORD);
    await page.getByRole("button", { name: "Generate my authenticator secret" }).click();
    secret = (await page.getByTestId("totp-secret").innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    expect(await page.getByTestId("backup-codes").locator("span").count()).toBeGreaterThan(3);

    await page.getByLabel("I have saved these backup codes somewhere safe").check();
    await page.getByLabel(/Enter the 6-digit code your app shows/).fill(totp(secret));
    await page.getByRole("button", { name: "Verify and finish setup" }).click();
    await expect(page.getByRole("status")).toContainText("Authenticator set up");

    // the setup session was ended: a password alone now asks for a code and shows nothing
    await fillCredentials(page);
    await expect(page.getByText("Two-factor authentication is required")).toBeVisible();
    await page.getByLabel("Authenticator Code (6 digits)").fill("000000");
    await page.getByRole("button", { name: "Verify & Complete Login" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByLabel("Authenticator Code (6 digits)").fill(totp(secret));
    await page.getByRole("button", { name: "Verify & Complete Login" }).click();
    await expect(page.getByRole("heading", { name: "Platform Overview" })).toBeVisible();
    await expect(page.getByText(STAFF_EMAIL)).toBeVisible();
  });

  test("create a store for a client: the owner gets a single-use invite link, nothing is faked", async ({ page }) => {
    await signInWithCode(page, secret);

    await page.goto(`${SUPERADMIN}/tenants/create`);
    await expect(page.getByRole("heading", { name: "Provision New Store" })).toBeVisible();
    const slug = `e2e-${Date.now().toString(36)}`;
    await page.getByLabel(/Store \/ Business Name/).fill("E2E Client Store");
    await page.getByLabel(/Subdomain Slug/).fill(slug);
    await page.getByLabel(/Store Owner Email/).fill(`${slug}@client.example`);
    await page.getByRole("button", { name: /Provision Store/ }).click();

    await expect(page.getByText("Store Provisioned Successfully!")).toBeVisible();
    const link = await page.locator("input.select-all").inputValue();
    expect(link).toMatch(/\/accept-invite\?token=[0-9a-f]{64}$/);

    // the store is listed and its page opens
    await page.goto(`${SUPERADMIN}/tenants`);
    await page.getByPlaceholder(/Search/i).fill(slug);
    await expect(page.getByText("E2E Client Store").first()).toBeVisible();
    await page.getByText("E2E Client Store").first().click();
    await expect(page.getByRole("heading", { name: "E2E Client Store" })).toBeVisible();

    // a support session starts read-only and hands over a one-time link
    await page.getByRole("button", { name: "Support Session" }).click();
    await page.getByPlaceholder(/Investigating checkout/).fill("E2E check of the support flow");
    await page.getByPlaceholder("e.g. TICKET-9481").fill("E2E-1");
    await page.getByRole("button", { name: "Start Support Session" }).click();
    await expect(page.getByRole("heading", { name: "Support session created" })).toBeVisible();
    const supportLink = await page.locator("input.select-all").last().inputValue();
    expect(supportLink).toMatch(/\/support#token=sup_[0-9a-f]{64}&store=/);
    await page.keyboard.press("Escape");

    // suspend and restore, both audited
    await page.getByRole("button", { name: "Suspend" }).click();
    await page.getByPlaceholder(/Non-payment/).fill("E2E suspension check");
    await page.getByRole("button", { name: "Confirm Suspension" }).click();
    await expect(page.getByRole("button", { name: "Restore Store" })).toBeVisible();
    await page.getByRole("button", { name: "Restore Store" }).click();
    await expect(page.getByRole("button", { name: "Suspend" })).toBeVisible();

    await page.goto(`${SUPERADMIN}/audit`);
    await expect(page.getByText("tenant.suspend").first()).toBeVisible();
    await expect(page.getByText("tenant.provisioned").first()).toBeVisible();
  });

  test("signing out ends the session", async ({ page }) => {
    await signInWithCode(page, secret);
    await page.getByRole("button", { name: "Staff account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto(`${SUPERADMIN}/tenants`);
    await expect(page).toHaveURL(/\/login/);
  });
});
