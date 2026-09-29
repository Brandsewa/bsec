import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { requestCustomerOtp, verifyCustomerOtp } from "../src/customers/otp.ts";
import { receiveWebhook } from "../src/system/webhooks.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

const orgId = "0199a0b1-0000-7000-8000-000000000000";
const tenantId = "0199a0b1-0000-7000-8000-000000000001";
const phone = "919800000001";

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 5 });

  const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pg.connect();
  await pg.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Security Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'security-fixes-b1', 'Security Fixes B1') ON CONFLICT DO NOTHING;
    DELETE FROM webhook_inbox WHERE provider = 'razorpay' AND event_id LIKE 'evt_secfix_%';
  `);
  await pg.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

describe("OTP attempt limit", () => {
  it("persists failed attempts so the code is locked after 5 wrong guesses", async () => {
    const { devOtp } = await requestCustomerOtp(rwDb.db, tenantId, phone);
    const wrong = devOtp === "123456" ? "654321" : "123456";

    for (let i = 0; i < 5; i++) {
      await expect(verifyCustomerOtp(rwDb.db, tenantId, phone, wrong)).rejects.toThrow("Invalid or expired OTP");
    }

    // The correct code must now be rejected: the 5 failures were committed, not rolled back.
    await expect(verifyCustomerOtp(rwDb.db, tenantId, phone, devOtp!)).rejects.toThrow("Invalid or expired OTP");
  });
});

describe("webhook inbox poisoning", () => {
  async function row(eventId: string) {
    const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pg.connect();
    const { rows } = await pg.query(
      "SELECT signature_valid, status FROM webhook_inbox WHERE provider = 'razorpay' AND event_id = $1",
      [eventId],
    );
    await pg.end();
    return rows;
  }

  it("a validly signed event replaces an earlier forged one with the same event id", async () => {
    const eventId = "evt_secfix_1";
    const forged = await receiveWebhook(rwDb.db, {
      provider: "razorpay",
      eventId,
      signatureValid: false,
      rawPayload: { event: "payment.captured", forged: true },
    });
    expect(forged.duplicate).toBe(false);

    const real = await receiveWebhook(rwDb.db, {
      provider: "razorpay",
      eventId,
      signatureValid: true,
      rawPayload: { event: "payment.captured" },
    });
    expect(real.duplicate).toBe(false);

    const rows = await row(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].signature_valid).toBe(true);
    expect(rows[0].status).toBe("received");
  });

  it("a duplicate of an already-valid event is still ignored, and a later forged copy cannot downgrade it", async () => {
    const eventId = "evt_secfix_2";
    const first = await receiveWebhook(rwDb.db, {
      provider: "razorpay",
      eventId,
      signatureValid: true,
      rawPayload: { event: "payment.captured" },
    });
    expect(first.duplicate).toBe(false);

    const again = await receiveWebhook(rwDb.db, {
      provider: "razorpay",
      eventId,
      signatureValid: true,
      rawPayload: { event: "payment.captured" },
    });
    expect(again.duplicate).toBe(true);

    const forgedLater = await receiveWebhook(rwDb.db, {
      provider: "razorpay",
      eventId,
      signatureValid: false,
      rawPayload: { forged: true },
    });
    expect(forgedLater.duplicate).toBe(true);
    expect((await row(eventId))[0].signature_valid).toBe(true);
  });
});
