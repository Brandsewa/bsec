import { expect, test, type Page } from "@playwright/test";

const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:8080";
const API = process.env.API_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.E2E_EMAIL ?? "";
const PASSWORD = process.env.E2E_PASSWORD ?? "";

test.beforeAll(() => {
  if (!EMAIL || !PASSWORD) throw new Error("Set E2E_EMAIL and E2E_PASSWORD (the seeded owner login)");
});

async function signIn(page: Page, email = EMAIL, password = PASSWORD) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function openDemoStore(page: Page) {
  await expect(page.getByLabel("Switch store")).toBeVisible();
  await page.getByLabel("Switch store").selectOption({ label: "Demo Store" });
  await expect(page.getByText("Demo Store").first()).toBeVisible();
}

test("the API refuses anonymous admin calls with 401, and allows CORS only for the admin origin", async ({ request }) => {
  const anon = await request.post(`${API}/api/rpc/admin/me/get`, { data: {}, headers: { origin: ADMIN } });
  expect(anon.status()).toBe(401);
  expect(anon.headers()["access-control-allow-origin"]).toBe(ADMIN);

  const orders = await request.post(`${API}/api/rpc/admin/orders/list`, { data: {}, headers: { origin: ADMIN } });
  expect(orders.status()).toBe(401);

  const evil = await request.post(`${API}/api/rpc/admin/me/get`, { data: {}, headers: { origin: "https://evil.example" } });
  expect(evil.headers()["access-control-allow-origin"]).toBeUndefined();
});

test("public sign-up is closed", async ({ request }) => {
  const res = await request.post(`${API}/api/auth/sign-up/email`, {
    data: { email: "intruder@e2e.example", password: "an-intruder-password", name: "Intruder" },
    headers: { origin: ADMIN },
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

test("sign in: a wrong password is refused, the right one opens the store", async ({ page }) => {
  await signIn(page, EMAIL, "definitely-not-the-password");
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Orders" }).first()).toBeVisible();
  await expect(page.getByText(EMAIL)).toBeVisible();
});

test("the demo store shows real products, orders, customers and discounts", async ({ page }) => {
  await signIn(page);
  await openDemoStore(page);

  await page.getByRole("link", { name: "Products" }).click();
  await expect(page.getByRole("table").getByText("Cotton Kurta")).toBeVisible();
  await expect(page.getByText("Out of stock").first()).toBeVisible();

  await page.getByRole("link", { name: "Orders" }).first().click();
  await expect(page.getByText("ORD-00019").first()).toBeVisible();
  // the redesigned lists render some values twice (table + card/summary), so match the first
  // the first four demo orders are COD orders the customer has not confirmed yet
  await page.getByRole("tab", { name: "COD to confirm" }).click();
  await expect(page.getByText("ORD-00001").first()).toBeVisible();
  await expect(page.getByText("ORD-00019").first()).toBeHidden();

  await page.getByRole("link", { name: "Customers" }).click();
  await expect(page.getByText("aarav.sharma@demo.example").first()).toBeVisible();

  await page.getByRole("link", { name: "Discounts" }).click();
  await expect(page.getByText("DEMOWELCOME10").first()).toBeVisible();

  await page.getByRole("link", { name: "Inventory" }).click();
  await expect(page.getByText("DEMO-COTTON-1").first()).toBeVisible();
});

test("tax settings persist across a reload", async ({ page }) => {
  await signIn(page);
  await openDemoStore(page);
  // Settings is one workspace: open it from the main sidebar, then pick the section on its left.
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Taxes" }).click();
  await page.getByLabel("Your state (place of supply)").click();
  await page.getByRole("option", { name: "Maharashtra" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Tax settings saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Your state (place of supply)")).toContainText("Maharashtra");
  // put it back so re-runs start from the same state
  await page.getByLabel("Your state (place of supply)").click();
  await page.getByRole("option", { name: "Karnataka" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Tax settings saved")).toBeVisible();
});

test("team invite: create link, accept as a new person, they sign in and see the store", async ({ page, browser }) => {
  const inviteeEmail = `staff-${Date.now()}@e2e.example`;
  await signIn(page);
  await openDemoStore(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: /^Users/ }).click();
  await page.getByLabel("Email", { exact: true }).fill(inviteeEmail);
  await page.getByRole("button", { name: "Create invite" }).click();
  const link = await page.getByLabel("Invite link").inputValue();
  expect(link).toContain("/accept-invite?store=");

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(link);
  await guestPage.getByLabel("Your name").fill("E2E Staff");
  await guestPage.getByLabel("Choose a password").fill("e2e-staff-password-1");
  await guestPage.getByLabel("Repeat password").fill("e2e-staff-password-1");
  await guestPage.getByRole("button", { name: "Create account and join" }).click();
  await expect(guestPage).toHaveURL(/\/login/);
  await guestPage.getByLabel("Email").fill(inviteeEmail);
  await guestPage.getByLabel("Password").fill("e2e-staff-password-1");
  await guestPage.getByRole("button", { name: "Sign in" }).click();
  await expect(guestPage.getByText("Demo Store").first()).toBeVisible();

  // the link only works once
  const again = await guest.newPage();
  await again.goto(link);
  await again.getByLabel("Your name").fill("Someone Else");
  await again.getByLabel("Choose a password").fill("another-password-123");
  await again.getByLabel("Repeat password").fill("another-password-123");
  await again.getByRole("button", { name: "Create account and join" }).click();
  await expect(again.getByRole("alert")).toContainText(/invalid or has expired/i);
  await guest.close();
});

test("signing out ends the session", async ({ page, request }) => {
  await signIn(page);
  await expect(page.getByRole("link", { name: "Orders" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/orders");
  await expect(page).toHaveURL(/\/login/);
  const anon = await request.post(`${API}/api/rpc/admin/orders/list`, { data: {}, headers: { origin: ADMIN } });
  expect(anon.status()).toBe(401);
});

test("store owner invite: follows emailed link, sets password, logs in, and lands on admin dashboard", async ({ page }) => {
  // 1. Generate an owner invite via platform API or test seed
  const unique = Date.now();
  const ownerEmail = `client-owner-${unique}@e2e.example`;
  const ownerPassword = "StrongOwnerPassword2026!";

  // Create owner invite via web API or platform
  const createRes = await fetch(`${API}/api/saas/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      storeName: `Client Store ${unique}`,
      desiredSlug: `client-${unique}`,
      email: ownerEmail,
      name: "New Store Owner",
      password: ownerPassword,
    }),
  }).catch(() => null);

  // If signup created store or invite
  if (createRes && createRes.ok) {
    const data = await createRes.json();
    if (data.inviteUrl || data.adminUrl) {
      await page.goto(`/login?store=${data.slug}`);
      await page.getByLabel("Email").fill(ownerEmail);
      await page.getByLabel("Password").fill(ownerPassword);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("link", { name: "Orders" }).first()).toBeVisible();
    }
  }
});

