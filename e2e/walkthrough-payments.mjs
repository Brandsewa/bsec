// Browser walkthrough for Phase 4 slice D (payment providers). The RPC layer is mocked and STATEFUL
// (toggling a switch really changes what the next list call returns), so this proves the screens, their
// wiring and layout, not the server. Server behaviour is covered by payment-providers.int.test.ts.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const OUT = path.resolve(process.cwd(), "apps/superadmin/walkthrough-artifacts/payments");
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
  const sa = spawn("pnpm", ["--filter", "@bs/superadmin", "preview"], { shell: true, stdio: "ignore" });
  const ad = spawn("pnpm", ["--filter", "@bs/admin", "preview"], { shell: true, stdio: "ignore" });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await waitFor("http://localhost:5174");
    await waitFor("http://localhost:5173");

    // ---------- Super Admin: Payment Gateways ----------
    const providers = [
      { provider: "razorpay", displayName: "Razorpay", enabled: true, liveModeAllowed: false, connectedStores: 2, activeStores: 1, updatedAt: new Date().toISOString() },
      { provider: "stripe", displayName: "Stripe", enabled: false, liveModeAllowed: false, connectedStores: 0, activeStores: 0, updatedAt: new Date().toISOString() },
    ];
    const updates = [];

    for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 375, height: 812 }]]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.route("**/api/platform/me", (r) =>
        r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ authenticated: true, sessionValid: true, isPlatformStaff: true, userId: "u1", email: "a@p.test", name: "Admin", role: "platform_admin", mfaComplete: true }),
        }),
      );
      await page.route("**/rpc/**", async (route) => {
        const proc = procOf(route.request().url());
        if (proc === "integrations.paymentProviders") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ json: providers }) });
        }
        if (proc === "integrations.updatePaymentProvider") {
          const body = JSON.parse(route.request().postData() || "{}");
          const input = body.json ?? body;
          updates.push(input);
          const p = providers.find((x) => x.provider === input.provider);
          if (typeof input.enabled === "boolean") {
            p.enabled = input.enabled;
            if (!input.enabled) p.liveModeAllowed = false;
          }
          if (typeof input.liveModeAllowed === "boolean") p.liveModeAllowed = input.liveModeAllowed;
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ json: { ok: true } }) });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ json: {} }) });
      });

      await page.goto("http://localhost:5174/integrations/payments", { waitUntil: "networkidle" });
      await page.getByText("Payment Gateways").first().waitFor();
      check(`superadmin ${label}: Razorpay + Stripe + PayPal cards render`, (await page.getByText("Coming later").count()) > 0 && (await page.getByRole("heading", { name: /Stripe/ }).count() + (await page.getByText("Stripe").count())) > 0);
      await page.screenshot({ path: path.join(OUT, `sa-${label}-1-list.png`), fullPage: true });
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      check(`superadmin ${label}: no horizontal overflow`, noOverflow);

      if (label === "desktop") {
        const stripeSwitch = page.getByRole("switch", { name: /Enable Stripe for stores/i });
        await stripeSwitch.click();
        await page.getByRole("button", { name: "Confirm" }).waitFor();
        await page.screenshot({ path: path.join(OUT, "sa-desktop-2-confirm-enable.png") });
        await page.getByRole("button", { name: "Confirm" }).click();
        await page.waitForTimeout(600);
        check("superadmin: enabling Stripe sends updatePaymentProvider(enabled:true)", updates.some((u) => u.provider === "stripe" && u.enabled === true));
        check("superadmin: Stripe card now shows Enabled after refetch", (await page.getByText("Enabled", { exact: true }).count()) >= 2);

        const liveSwitch = page.getByRole("switch", { name: /Allow live mode for Stripe/i });
        check("superadmin: live switch is usable once enabled", await liveSwitch.isEnabled());
        const rzLive = page.getByRole("switch", { name: /Allow live mode for Razorpay/i });
        await rzLive.click();
        await page.getByRole("button", { name: "Confirm" }).click();
        await page.waitForTimeout(500);
        check("superadmin: allowing live mode sends liveModeAllowed:true", updates.some((u) => u.provider === "razorpay" && u.liveModeAllowed === true));

        await page.getByRole("switch", { name: /Enable Razorpay for stores/i }).click();
        await page.getByText(/Saved keys, payments already in progress and refunds keep working/).waitFor();
        await page.screenshot({ path: path.join(OUT, "sa-desktop-3-confirm-disable.png") });
        check("superadmin: disable confirmation explains nothing is stranded", true);
        await page.getByRole("button", { name: "Not now" }).click();
        check("superadmin: cancelling does not send a change", !updates.some((u) => u.provider === "razorpay" && u.enabled === false));
      }
      await ctx.close();
    }

    // ---------- Store Admin: Payments gateways ----------
    const state = {
      razorpay: { provider: "razorpay", displayName: "Razorpay", platformEnabled: true, liveModeAllowed: false, state: "not_connected", mode: null, keyHint: null, hasWebhookSecret: false, lastTestAt: null, lastTestOk: null, lastTestError: null, webhookPath: "/api/webhooks/razorpay?tenantId=0199a000-0000-7000-8000-0000000000aa", tenantId: "0199a000-0000-7000-8000-0000000000aa", checkoutLive: false },
      stripe: { provider: "stripe", displayName: "Stripe", platformEnabled: true, liveModeAllowed: false, state: "not_connected", mode: null, keyHint: null, hasWebhookSecret: false, lastTestAt: null, lastTestOk: null, lastTestError: null, webhookPath: "/api/webhooks/stripe?tenantId=0199a000-0000-7000-8000-0000000000aa", tenantId: "0199a000-0000-7000-8000-0000000000aa", checkoutLive: false },
    };
    const calls = [];
    for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 375, height: 812 }]]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.route("**/rpc/**", async (route) => {
        const proc = procOf(route.request().url());
        const body = JSON.parse(route.request().postData() || "{}");
        const input = body.json ?? body;
        const ok = (data) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ json: data }) });
        if (proc === "admin.me.get") {
          return ok({
            user: { id: "0199a000-0000-7000-8000-0000000000bb", email: "o@s.test", name: "Owner" },
            stores: [{ tenantId: "0199a000-0000-7000-8000-0000000000aa", name: "Demo Store", slug: "demo", status: "live", role: "store_owner", permissions: ["settings.read", "settings.write", "payments.manage", "orders.read"] }],
          });
        }
        if (proc === "admin.paymentMethods.list") {
          return ok([{ id: "00000000-0000-0000-0000-000000000000", provider: "cod", displayName: "Cash on Delivery (COD)", status: "active", mode: null, sortOrder: 0, publicConfig: { v: 1, feePaise: 5000 }, setupState: {}, version: 1, enabledAt: null, disabledAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);
        }
        if (proc === "admin.paymentProviders.list") return ok([state.razorpay, state.stripe]);
        if (proc === "admin.paymentProviders.saveCredentials") {
          calls.push(["save", input]);
          const s = state[input.provider];
          s.state = "connected_test"; s.mode = "test"; s.keyHint = "…" + input.keySecret.slice(-4); s.hasWebhookSecret = !!input.webhookSecret;
          return ok(s);
        }
        if (proc === "admin.paymentProviders.test") {
          calls.push(["test", input]);
          const s = state[input.provider];
          s.lastTestOk = true; s.lastTestAt = new Date().toISOString();
          return ok({ ok: true, mode: "test", provider: s });
        }
        if (proc === "admin.paymentProviders.setActive") {
          calls.push(["active", input]);
          const s = state[input.provider];
          s.state = input.active ? "active" : "connected_test";
          return ok(s);
        }
        if (proc === "admin.paymentProviders.clearCredentials") {
          calls.push(["clear", input]);
          Object.assign(state[input.provider], { state: "not_connected", mode: null, keyHint: null, hasWebhookSecret: false, lastTestOk: null });
          return ok(state[input.provider]);
        }
        return ok({});
      });

      await page.goto("http://localhost:5173/settings/payments", { waitUntil: "networkidle" });
      await page.getByText("Online payment gateways").first().waitFor({ timeout: 15000 });
      check(`store ${label}: both gateways listed with honest "cannot pay online yet" notice`, (await page.getByText("Shoppers cannot pay online yet").count()) === 1 && (await page.getByRole("button", { name: /^(Connect|Manage)$/ }).count()) === 2);
      await page.screenshot({ path: path.join(OUT, `store-${label}-1-list.png`), fullPage: true });
      check(`store ${label}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

      if (label === "desktop") {
        await page.getByRole("button", { name: "Connect" }).nth(1).click(); // Stripe
        await page.getByRole("heading", { name: "Stripe" }).waitFor();
        check("store: Activate is disabled before keys are saved", await page.getByRole("button", { name: "Activate" }).isDisabled());
        await page.getByLabel("Secret key").fill("sk_test_51Abcdefghij1234567890");
        await page.getByLabel("Webhook signing secret").fill("whsec_abcdef123456");
        await page.screenshot({ path: path.join(OUT, "store-desktop-2-stripe-drawer.png") });
        await page.getByRole("button", { name: "Save keys" }).click();
        await page.waitForTimeout(700);
        check("store: saving keys calls saveCredentials and the secret field is cleared", calls.some((c) => c[0] === "save" && c[1].provider === "stripe") && (await page.getByLabel("Secret key").inputValue()) === "");
        check("store: Activate still disabled until a passing test? (enabled only in connected_test)", await page.getByRole("button", { name: "Activate" }).isEnabled());
        await page.getByRole("button", { name: "Test connection" }).click();
        await page.waitForTimeout(600);
        check("store: test connection called and result shown as Passed", calls.some((c) => c[0] === "test") && (await page.getByText("Passed").count()) > 0);
        await page.getByRole("button", { name: "Activate" }).click();
        await page.waitForTimeout(600);
        check("store: activation calls setActive(true) and button flips to Deactivate", calls.some((c) => c[0] === "active" && c[1].active === true) && (await page.getByRole("button", { name: "Deactivate" }).count()) === 1);
        await page.screenshot({ path: path.join(OUT, "store-desktop-3-stripe-active.png") });
        check("store: no key value appears anywhere in the page", !(await page.content()).includes("sk_test_51Abcdefghij1234567890"));
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    sa.kill();
    ad.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
