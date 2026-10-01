import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { eq } from "drizzle-orm";
import {
  createRuntime,
  type Runtime,
  checkSubdomainAvailability,
  reserveSubdomain,
  isDisposableEmail,
  checkSignupRateLimit,
  assertTrialStoreLimit,
  saveSignupLead,
  completeSignup,
  provisionTenant,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let platformDb: DbHandle;
let rt: Runtime;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
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
  rwDb = createDb(as("app_rw", PW.rw), { max: 15 });
  platformDb = createDb(as("app_platform", PW.platform), { max: 5 });
  rt = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 15 });
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await platformDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("M8 Signup Pipeline & Abuse Protection (PLAN §5.2, §7 / ADR-016)", () => {
  it("validates subdomain availability, reservations and conflicts", async () => {
    const slug = "fresh-bakery-82";

    // 1. Available check
    const check1 = await checkSubdomainAvailability(rt._db.db, slug);
    expect(check1.available).toBe(true);

    // 2. Reserve slug
    const res = await reserveSubdomain(rt._db.db, slug);
    expect(res.success).toBe(true);
    expect(res.expiresAt!.getTime()).toBeGreaterThan(Date.now());

    // 3. Check again from another context -> unavailable
    const check2 = await checkSubdomainAvailability(rt._db.db, slug);
    expect(check2.available).toBe(false);
    expect(check2.reason).toBe("This subdomain is temporarily reserved by someone completing signup");

    // 4. Check from matching reservation
    const checkWithLead = await checkSubdomainAvailability(rt._db.db, slug);
    expect(checkWithLead.available).toBe(false);

    // 5. Reserved platform slug -> unavailable
    const checkReserved = await checkSubdomainAvailability(rt._db.db, "admin");
    expect(checkReserved.available).toBe(false);
    expect(checkReserved.reason).toBe("This subdomain is reserved by the platform");

    // 6. Malformed slug -> unavailable
    const checkInvalid = await checkSubdomainAvailability(rt._db.db, "ab");
    expect(checkInvalid.available).toBe(false);
    expect(checkInvalid.reason).toContain("at least 3 characters");
  });

  it("enforces abuse protection barriers (disposable email, rate limit, max 3 trial stores)", async () => {
    // Disposable emails blocked
    expect(isDisposableEmail("test@mailinator.com")).toBe(true);
    expect(isDisposableEmail("anon@tempmail.com")).toBe(true);
    expect(isDisposableEmail("legit@company.co.in")).toBe(false);
    expect(isDisposableEmail("founder@gmail.com")).toBe(false);

    // Rate limiting: check 5 requests per IP (using distinct emails to not trip email limit)
    const testIp = "192.168.10.42";
    for (let i = 0; i < 5; i++) {
      const rl = await checkSignupRateLimit(rt._db.db, testIp, `speedy${i}@tester.local`);
      expect(rl.allowed).toBe(true);
    }
    // 6th attempt from same IP should be blocked
    const rlBlocked = await checkSignupRateLimit(rt._db.db, testIp, "another@tester.local");
    expect(rlBlocked.allowed).toBe(false);

    // Trial Store Limit: max 3 per user email
    const multiStoreEmail = "serial-creator-82@storebuilder.local";

    // Provision 3 trial stores for this user (an agency creating stores for one client goes through the platform
    // path: self-service signup refuses an email that already has an account)
    for (let i = 1; i <= 3; i++) {
      await provisionTenant(rt, {
        storeName: `Multi Store ${i}`,
        slug: `multi-store-82-${i}`,
        source: "platform_admin",
        owner: {
          email: multiStoreEmail,
          name: "Serial Creator",
        },
      });
    }

    // Checking trial store limit for 4th store must fail
    await expect(assertTrialStoreLimit(rt._db.db, multiStoreEmail)).rejects.toThrow(
      /Trial store limit reached/,
    );
  });

  it("persists incremental signup leads through wizard steps", async () => {
    // Step 1: started
    const { leadId } = await saveSignupLead(rt._db.db, {
      email: "lead@organicfoods.local",
      step: "started",
    });
    expect(leadId).toBeDefined();

    // Step 2: subdomain selected
    await saveSignupLead(rt._db.db, {
      leadId,
      desiredSlug: "organic-foods-82",
      step: "subdomain_selected",
    });

    // Step 3: details entered
    await saveSignupLead(rt._db.db, {
      leadId,
      businessName: "Organic Foods Co",
      phone: "+919876500000",
      industry: "grocery",
      step: "basics_entered",
    });

    const [lead] = await rt._db.db
      .select()
      .from(schema.signupLeads)
      .where(eq(schema.signupLeads.id, leadId));

    expect(lead).toBeDefined();
    expect(lead!.desiredSlug).toBe("organic-foods-82");
    expect(lead!.businessName).toBe("Organic Foods Co");
    expect(lead!.phone).toBe("+919876500000");
    expect(lead!.step).toBe("basics_entered");
  });

  it("completes full 6-step self-service signup pipeline end-to-end", async () => {
    const slug = "complete-flow-82";
    const email = "founder@completeflow.local";

    // 1. Initial lead capture
    const { leadId } = await saveSignupLead(rt._db.db, {
      email,
      desiredSlug: slug,
      step: "subdomain_selected",
    });

    // 2. Subdomain reservation for lead
    await reserveSubdomain(rt._db.db, slug, leadId);

    // 3. Complete signup pipeline
    const result = await completeSignup(rt, {
      leadId,
      storeName: "Complete Flow Store",
      slug,
      owner: {
        email,
        name: "Devina Gupta",
        password: "VerySecurePassword123#",
        phone: "+919811223344",
      },
      planCode: "starter",
      themeTemplate: "starter-minimal",
      clientIp: "203.0.113.195",
    });

    expect(result.slug).toBe(slug);
    expect(result.hostname).toBe(`${slug}.gobs.cloud`);
    expect(result.tenantId).toBeDefined();

    // Verify lead status was updated to store_created
    const [lead] = await rt._db.db
      .select()
      .from(schema.signupLeads)
      .where(eq(schema.signupLeads.id, leadId));
    expect(lead!.step).toBe("store_created");

    // Verify trial subscription was created
    const [sub] = await rt._db.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, result.tenantId));
    expect(sub!.status).toBe("trialing");
  });
});
