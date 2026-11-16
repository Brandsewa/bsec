/** Audit A4-02: webhook requests with an invalid signature are purged after a day; verified events and recent rows stay. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, type DbHandle } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { receiveWebhook } from "../src/system/webhooks.ts";
import { pruneInvalidWebhookInbox } from "../src/system/retention.ts";

let env: TestDb;
let rw: DbHandle;

beforeAll(async () => {
  env = await startTestDb();
  rw = createDb(env.as("app_rw"), { applicationName: "bsec-test-rw" });
}, 120_000);

afterAll(async () => {
  await rw?.close();
  await env?.stop();
});

const present = async (eventId: string) =>
  (await rw.db.execute<{ id: string }>(sql`select id from webhook_inbox where event_id = ${eventId}`)).rows.length === 1;

describe("webhook inbox retention (real DB)", () => {
  it("deletes invalid-signature requests older than 24 hours and keeps recent and verified ones", async () => {
    const ingest = (eventId: string, signatureValid: boolean) =>
      receiveWebhook(rw.db, { provider: "razorpay", eventId, tenantId: null, signatureValid, rawPayload: { event: "payment.captured" } } as never);
    await ingest("evt_old_invalid", false);
    await ingest("evt_new_invalid", false);
    await ingest("evt_old_valid", true);
    await rw.db.execute(sql`update webhook_inbox set created_at = now() - interval '2 days' where event_id in ('evt_old_invalid', 'evt_old_valid')`);

    const res = await pruneInvalidWebhookInbox(rw.db, 24);
    expect(res.deletedCount).toBeGreaterThanOrEqual(1);
    expect(await present("evt_old_invalid")).toBe(false);
    expect(await present("evt_new_invalid")).toBe(true);
    expect(await present("evt_old_valid")).toBe(true);
  });
});
