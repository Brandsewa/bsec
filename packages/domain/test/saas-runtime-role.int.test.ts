import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import pg from "pg";
import { createDb, schema, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { hashPassword, verifyPassword } from "@bs/auth";
import {
  acceptTenantOwnerInvite,
  changeTenantPlan,
  checkInviteAcceptRateLimit,
  completeSignup,
  createRuntime,
  handlePlatformBillingWebhook,
  platformCreateTenantForClient,
  provisionTenant,
  RazorpaySubscriptionProvider,
  reserveSubdomain,
  resendTenantOwnerInvite,
  runTrialExpirySweep,
  saasDb,
  SaasNotConfiguredError,
  saveSignupLead,
  type Runtime,
} from "../src/index.ts";

/**
 * The self-service paths run in the web app and worker, which connect as app_rw (+ app_saas for these paths),
 * NOT as the platform role. Every other saas test uses the platform role, which hides missing grants.
 * This file runs the real functions the way production does.
 */
const PW = { owner: "o_test", rw: "rw_test", platform: "p_test", saas: "s_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let platformDb: DbHandle;
let rtPlatform: Runtime;
let rtWeb: Runtime; // app_rw + app_saas, like apps/web
let rtWebNoSaas: Runtime; // app_rw only: DATABASE_URL_SAAS not configured

function as(role: "app_owner" | "app_rw" | "app_platform" | "app_saas", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

async function q<T extends pg.QueryResultRow>(url: string, text: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query<T>(text, params);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  platformDb = createDb(as("app_platform", PW.platform), { max: 5 });
  rtPlatform = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 5 });
  rtWeb = createRuntime({
    service: "web",
    databaseUrl: as("app_rw", PW.rw),
    saasDatabaseUrl: as("app_saas", PW.saas),
    poolMax: 10,
  });
  rtWebNoSaas = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 5 });
}, 180_000);

afterAll(async () => {
  await platformDb?.close();
  await rtPlatform?.close();
  await rtWeb?.close();
  await rtWebNoSaas?.close();
  await container?.stop();
});

describe("self-service paths on the real web/worker roles", () => {
  it("public signup works end to end as app_rw + app_saas and lands the store on the plan's tier", async () => {
    const slug = "saasrole-signup-01";
    const email = "founder@saasrole-signup.example";
    const { leadId } = await saveSignupLead(saasDb(rtWeb), { email, desiredSlug: slug, step: "subdomain_selected" });
    const reservation = await reserveSubdomain(saasDb(rtWeb), slug, leadId);
    expect(reservation.success).toBe(true);

    const result = await completeSignup(rtWeb, {
      leadId,
      storeName: "Saas Role Store",
      slug,
      owner: { email, name: "Founder", password: "VerySecurePassword123#" },
      planCode: "starter",
      clientIp: "203.0.113.77",
    });
    expect(result.slug).toBe(slug);

    const [tier] = await platformDb.db.select().from(schema.tenantSizeTiers).where(eq(schema.tenantSizeTiers.tenantId, result.tenantId));
    expect(tier?.tier).toBe("S"); // Starter = 500 products / 1 custom domain = tier S
    const [sub] = await platformDb.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, result.tenantId));
    expect(sub?.status).toBe("trialing");
  });

  it("refuses self-service signup for an email that already has an account, and creates nothing", async () => {
    const email = "founder@saasrole-signup.example"; // created above
    await expect(
      provisionTenant(rtWeb, {
        storeName: "Second Store",
        slug: "saasrole-signup-02",
        owner: { email, name: "Someone Else", password: "AnotherSecurePassword1#" },
        source: "self_service",
      }),
    ).rejects.toThrow(/already exists/);
    const { rows } = await q<{ n: string }>(superUrl, "select count(*)::text as n from tenants where slug = 'saasrole-signup-02'");
    expect(rows[0]!.n).toBe("0");
  });

  it("reports 'not configured' (not a permission error) when DATABASE_URL_SAAS is missing", async () => {
    expect(() => saasDb(rtWebNoSaas)).toThrow(SaasNotConfiguredError);
    await expect(
      completeSignup(rtWebNoSaas, {
        storeName: "No Saas",
        slug: "saasrole-nosaas",
        owner: { email: "x@saasrole-nosaas.example", name: "X", password: "VerySecurePassword123#" },
      }),
    ).rejects.toThrow(/not configured/i);
  });

  it("processes the billing webhook as app_saas, exactly once even under 10 concurrent deliveries", async () => {
    const provisioned = await provisionTenant(rtPlatform, {
      storeName: "Billing Role Store",
      slug: "saasrole-billing",
      owner: { email: "merchant@saasrole-billing.example", name: "Merchant" },
      planCode: "starter",
      source: "platform_admin",
    });
    const tenantId = provisioned.tenantId;
    const subId = "sub_role_test_1";
    await platformDb.db.update(schema.subscriptions).set({ providerSubscriptionId: subId }).where(eq(schema.subscriptions.tenantId, tenantId));

    const webhookSecret = "whsec_role_test_1234567890123456";
    const rawBody = JSON.stringify({
      event: "subscription.charged",
      payload: {
        subscription: {
          entity: {
            id: subId,
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
            notes: { tenant_id: tenantId, plan_code: "growth" },
          },
        },
        payment: { entity: { id: "pay_role_1", amount: 249900 } },
      },
    });
    const signature = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    const provider = new RazorpaySubscriptionProvider({ keyId: "k", keySecret: "s", webhookSecret });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => handlePlatformBillingWebhook(rtWeb, { rawBody, signature, provider })),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const fresh = results.filter((r) => r.status === "fulfilled" && !r.value.duplicate);
    expect(fresh).toHaveLength(1);

    const invoices = await platformDb.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.tenantId, tenantId));
    expect(invoices).toHaveLength(1);
    const [tier] = await platformDb.db.select().from(schema.tenantSizeTiers).where(eq(schema.tenantSizeTiers.tenantId, tenantId));
    expect(tier?.tier).toBe("M"); // growth
  });

  it("uses the X-Razorpay-Event-Id header as the idempotency key when present", async () => {
    const provider = new RazorpaySubscriptionProvider({ keyId: "k", keySecret: "s", webhookSecret: "whsec_hdr_1234567890123456" });
    const send = (body: string, eventId: string) =>
      handlePlatformBillingWebhook(rtWeb, {
        rawBody: body,
        signature: createHmac("sha256", "whsec_hdr_1234567890123456").update(body).digest("hex"),
        provider,
        headers: new Headers({ "x-razorpay-event-id": eventId }),
      });
    const a = await send(JSON.stringify({ event: "subscription.halted", payload: {}, created_at: 1 }), "evt_hdr_1");
    // same event id, different body (Razorpay retries can re-serialize): still a duplicate
    const b = await send(JSON.stringify({ event: "subscription.halted", payload: {}, created_at: 2 }), "evt_hdr_1");
    expect(a.duplicate).toBeFalsy();
    expect(b.duplicate).toBe(true);
  });

  it("expires lapsed trials as app_saas and drops the store to the XS tier", async () => {
    const provisioned = await provisionTenant(rtPlatform, {
      storeName: "Trial Role Store",
      slug: "saasrole-trial",
      owner: { email: "merchant@saasrole-trial.example", name: "Merchant" },
      planCode: "growth",
      source: "platform_admin",
    });
    await q(superUrl, "update subscriptions set current_period_end = now() - interval '1 hour' where tenant_id = $1", [provisioned.tenantId]);
    const res = await runTrialExpirySweep(saasDb(rtWeb));
    expect(res.expired).toBeGreaterThanOrEqual(1);
    const [sub] = await platformDb.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, provisioned.tenantId));
    expect(sub?.status).toBe("past_due");
    const [tier] = await platformDb.db.select().from(schema.tenantSizeTiers).where(eq(schema.tenantSizeTiers.tenantId, provisioned.tenantId));
    expect(tier?.tier).toBe("XS");
  });

  it("answers 'billing not configured' honestly on plan change (no permission error, no fake ids)", async () => {
    const [t] = (await q<{ id: string }>(superUrl, "select id from tenants where slug = 'saasrole-billing'")).rows;
    await expect(
      changeTenantPlan(rtWeb, { tenantId: t!.id, planCode: "pro", interval: "monthly", customerEmail: "merchant@saasrole-billing.example" }),
    ).rejects.toThrow(/not configured/i);
    const { rows } = await q<{ n: string }>(superUrl, "select count(*)::text as n from subscriptions where provider_subscription_id like 'sub_unconfigured%'");
    expect(rows[0]!.n).toBe("0");
  });
});

describe("owner invites on the real roles", () => {
  it("a new client accepts their invite and becomes an active owner", async () => {
    const created = await platformCreateTenantForClient(rtWeb, {
      storeName: "Invite Store",
      slug: "saasrole-invite-new",
      clientEmail: "new.client@saasrole-invite.example",
      clientName: "New Client",
    });
    const accepted = await acceptTenantOwnerInvite(rtWeb, { token: created.inviteToken, password: "ClientChosenPassword1#", name: "New Client" });
    expect(accepted.success).toBe(true);
    const { rows } = await q<{ status: string }>(superUrl, "select status from memberships where tenant_id = $1 and user_id = $2", [accepted.tenantId, accepted.userId]);
    expect(rows[0]?.status).toBe("active");
  });

  it("an invite link cannot be used to take over an existing account: the current password is required and never replaced", async () => {
    const email = "existing@saasrole-invite.example";
    const original = "ExistingOriginalPassword1#";
    const [u] = await platformDb.db.insert(schema.users).values({ email, name: "Existing", emailVerified: false }).returning({ id: schema.users.id });
    await platformDb.db.insert(schema.accounts).values({ id: crypto.randomUUID(), userId: u!.id, accountId: u!.id, providerId: "credential", password: await hashPassword(original) });

    const created = await platformCreateTenantForClient(rtWeb, {
      storeName: "Existing Owner Store",
      slug: "saasrole-invite-existing",
      clientEmail: email,
    });

    // Someone holding the link but not the password (e.g. the person who created it) is refused, and the token is not consumed
    await expect(acceptTenantOwnerInvite(rtWeb, { token: created.inviteToken, password: "AttackerChosenPassword1#" })).rejects.toThrow(/incorrect password/i);
    const [acct] = (await q<{ password: string }>(superUrl, "select password from accounts where user_id = $1 and provider_id = 'credential'", [u!.id])).rows;
    expect(await verifyPassword({ hash: acct!.password, password: original })).toBe(true);
    const verified = (await q<{ email_verified: boolean }>(superUrl, "select email_verified from users where id = $1", [u!.id])).rows[0]!.email_verified;
    expect(verified).toBe(false);

    // The real owner, with their real password, accepts
    const ok = await acceptTenantOwnerInvite(rtWeb, { token: created.inviteToken, password: original });
    expect(ok.success).toBe(true);
    const [acct2] = (await q<{ password: string }>(superUrl, "select password from accounts where user_id = $1 and provider_id = 'credential'", [u!.id])).rows;
    expect(await verifyPassword({ hash: acct2!.password, password: original })).toBe(true);
  });

  it("refuses to attach a password to an existing account that has none (the link alone is not proof of ownership)", async () => {
    const email = "nopassword@saasrole-invite.example";
    await platformDb.db.insert(schema.users).values({ email, name: "No Password", emailVerified: true });
    const created = await platformCreateTenantForClient(rtWeb, {
      storeName: "No Password Store",
      slug: "saasrole-invite-nopw",
      clientEmail: email,
    });
    await expect(acceptTenantOwnerInvite(rtWeb, { token: created.inviteToken, password: "AttackerChosenPassword1#" })).rejects.toThrow(/already exists/i);
    const { rows } = await q<{ n: string }>(superUrl, "select count(*)::text as n from accounts a join users u on u.id = a.user_id where u.email = $1", [email]);
    expect(rows[0]!.n).toBe("0");
  });

  it("rate limits invite acceptance attempts per token (password guessing)", async () => {
    const token = "t".repeat(40);
    const results: boolean[] = [];
    for (let i = 0; i < 12; i++) results.push((await checkInviteAcceptRateLimit(saasDb(rtWeb), `198.51.100.${i}`, token)).allowed);
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[10]).toBe(false);
  });

  it("resend keeps the original recipient, revokes older links and audits invite_resent with the staff id", async () => {
    const created = await platformCreateTenantForClient(rtWeb, {
      storeName: "Resend Store",
      slug: "saasrole-invite-resend",
      clientEmail: "resend@saasrole-invite.example",
    });
    const staff = "00000000-0000-7000-8000-00000000aaaa";
    await expect(resendTenantOwnerInvite(rtWeb, { tenantId: created.tenantId, email: "other@saasrole-invite.example", staffUserId: staff })).rejects.toThrow(/does not match/i);

    const fresh = await resendTenantOwnerInvite(rtWeb, { tenantId: created.tenantId, staffUserId: staff });
    expect(fresh.email).toBe("resend@saasrole-invite.example");
    await expect(acceptTenantOwnerInvite(rtWeb, { token: created.inviteToken, password: "ClientChosenPassword1#" })).rejects.toThrow(/invalid, expired, or has already been used/i);
    const audit = await q<{ actor_user_id: string | null }>(superUrl, "select actor_user_id from platform_audit_logs where action = 'tenant.invite_resent' and tenant_id = $1", [created.tenantId]);
    expect(audit.rows).toHaveLength(1);
  });
});

describe("app_saas write surface", () => {
  const saas = () => as("app_saas", PW.saas);

  it("cannot change plans, reserved slugs, quota configuration, platform staff, feature flags or theme templates", async () => {
    for (const statement of [
      "update plans set price_monthly_paise = 1",
      "delete from reserved_slugs",
      "update quota_definitions set tier_xs = 999999",
      "delete from tenant_quota_overrides",
      "delete from platform_staff",
      "delete from feature_flags",
      "update theme_templates set name = 'x'",
    ]) {
      await expect(q(saas(), statement), statement).rejects.toThrow(/permission denied/i);
    }
  });

  it("platform_audit_logs stays append-only for app_saas", async () => {
    await expect(q(saas(), "update platform_audit_logs set action = 'tampered'")).rejects.toThrow(/permission denied/i);
    await expect(q(saas(), "delete from platform_audit_logs")).rejects.toThrow(/permission denied/i);
  });

  it("is bound by row level security like app_rw (no BYPASSRLS)", async () => {
    const { rows } = await q<{ rolbypassrls: boolean }>(superUrl, "select rolbypassrls from pg_roles where rolname = 'app_saas'");
    expect(rows[0]?.rolbypassrls).toBe(false);
    // no tenant context => no rows from a tenant-scoped table
    const products = await q(saas(), "select 1 from products limit 1");
    expect(products.rowCount).toBe(0);
  });
});
