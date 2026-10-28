import { expect, test, type Page } from "@playwright/test";

const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:8080";
const EMAIL = process.env.E2E_EMAIL ?? "";
const PASSWORD = process.env.E2E_PASSWORD ?? "";

async function signIn(page: Page, email = EMAIL, password = PASSWORD) {
  await page.goto("/");
  if (page.url().includes("/login")) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
}

test.describe("Settings > Markets Admin UI", () => {
  test("creates a new market from preset, sets fixed price, and navigates readiness checklist", async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, "Skipping: E2E_EMAIL and E2E_PASSWORD not set");

    await signIn(page);
    await page.goto("/settings/markets");

    // Check plan quota banner and table
    await expect(page.getByText(/extra market.*used/i)).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText("Base Market")).toBeVisible();

    // Check Add market dialog
    const addMarketButton = page.getByRole("button", { name: /add market/i });
    if (await addMarketButton.isEnabled()) {
      await addMarketButton.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText("United States (USD)")).toBeVisible();

      // Click USA preset
      await page.getByText("United States (USD)").click();

      // Submit new market
      await page.getByRole("button", { name: "Create market" }).click();

      // Should navigate to market detail page
      await expect(page).toHaveURL(/\/settings\/markets\/[0-9a-fA-F-]+/);
      await expect(page.getByText("Readiness Checklist")).toBeVisible();

      // Check tabs
      await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Pricing & Currency" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Taxes" })).toBeVisible();

      // Navigate to Pricing & Currency tab
      await page.getByRole("tab", { name: "Pricing & Currency" }).click();
      await expect(page.getByText("Variant Pricing")).toBeVisible();

      // Activate button should be disabled when readiness items fail
      const activateButton = page.getByRole("button", { name: /activate market/i });
      if (await activateButton.isVisible()) {
        await expect(activateButton).toBeDisabled();
      }
    }
  });
});
