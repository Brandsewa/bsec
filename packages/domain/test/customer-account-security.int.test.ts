import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  getChannelConsent,
  getCustomerProfile,
  listCustomerSecurityEvents,
  listCustomerSessions,
  provisionTenant,
  recordCustomerSecurityEvent,
  requestCustomerOtp,
  revokeCustomerSession,
  revokeOtherCustomerSessions,
  setChannelConsent,
  verifyCustomerOtp,
  type Runtime,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const a = await provisionTenant(rt, { storeName: "cas-a", slug: "cas-a", owner: { email: "o@cas-a.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  const b = await provisionTenant(rt, { storeName: "cas-b", slug: "cas-b", owner: { email: "o@cas-b.test", name: "B" }, planCode: "starter", source: "platform_admin" });
  tenantA = a.tenantId;
  tenantB = b.tenantId;
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

const db = () => rtWeb._db.db;

async function signIn(tenantId: string, phone: string, userAgent = "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36") {
  const otp = await requestCustomerOtp(db(), tenantId, phone);
  return verifyCustomerOtp(db(), tenantId, phone, otp.devOtp!, { ip: "203.0.113.9", userAgent });
}

describe("customer sessions and security trail", () => {
  it("lists my sessions with the current one marked, and never exposes a token", async () => {
    const first = await signIn(tenantA, "9100000001");
    const second = await signIn(tenantA, "9100000001", "Mozilla/5.0 (iPhone) Safari/604");
    const list = await listCustomerSessions(db(), tenantA, first.customer.id, second.token);
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.map((s) => s.device).sort()).toEqual(["Chrome on Windows", "Safari on iOS"]);
    expect(JSON.stringify(list)).not.toContain("cs_");
  });

  it("signing in leaves a trail entry", async () => {
    const s = await signIn(tenantA, "9100000002");
    const events = await listCustomerSecurityEvents(db(), tenantA, s.customer.id);
    expect(events.map((e) => e.type)).toContain("sign_in");
    expect(events[0]?.device).toBe("Chrome on Windows");
  });

  it("revokes another device but refuses the current session and other shoppers' sessions", async () => {
    const a = await signIn(tenantA, "9100000003");
    const a2 = await signIn(tenantA, "9100000003");
    const other = await signIn(tenantA, "9100000004");
    const mine = await listCustomerSessions(db(), tenantA, a.customer.id, a2.token);
    const currentId = mine.find((s) => s.current)!.id;
    const otherId = mine.find((s) => !s.current)!.id;
    const theirs = (await listCustomerSessions(db(), tenantA, other.customer.id, other.token))[0]!.id;

    expect(await revokeCustomerSession(db(), tenantA, a.customer.id, currentId, a2.token)).toEqual({ revoked: false });
    expect(await revokeCustomerSession(db(), tenantA, a.customer.id, theirs, a2.token)).toEqual({ revoked: false });
    expect(await listCustomerSessions(db(), tenantA, other.customer.id, other.token)).toHaveLength(1);
    expect(await revokeCustomerSession(db(), tenantA, a.customer.id, otherId, a2.token)).toEqual({ revoked: true });
    expect((await listCustomerSessions(db(), tenantA, a.customer.id, a2.token)).map((s) => s.id)).toEqual([currentId]);
    expect((await listCustomerSecurityEvents(db(), tenantA, a.customer.id)).map((e) => e.type)).toContain("session_revoked");
  });

  it("signs out all other devices and keeps the current one", async () => {
    const a = await signIn(tenantA, "9100000005");
    await signIn(tenantA, "9100000005");
    const cur = await signIn(tenantA, "9100000005");
    expect(await revokeOtherCustomerSessions(db(), tenantA, a.customer.id, cur.token)).toEqual({ count: 2 });
    const left = await listCustomerSessions(db(), tenantA, a.customer.id, cur.token);
    expect(left).toHaveLength(1);
    expect(left[0]?.current).toBe(true);
  });

  it("a shopper in another store sees none of this (RLS)", async () => {
    const a = await signIn(tenantA, "9100000006");
    expect(await listCustomerSessions(db(), tenantB, a.customer.id, a.token)).toEqual([]);
    expect(await listCustomerSecurityEvents(db(), tenantB, a.customer.id)).toEqual([]);
    await recordCustomerSecurityEvent(db(), tenantB, a.customer.id, "password_changed"); // no such customer there: swallowed
    expect(await listCustomerSecurityEvents(db(), tenantA, a.customer.id)).not.toEqual([]);
  });
});

describe("customer channel consent", () => {
  it("defaults to off, saves, and is scoped to the store", async () => {
    const s = await signIn(tenantA, "9100000007");
    expect(await getChannelConsent(db(), tenantA, s.customer.id)).toMatchObject({ sms: false, whatsapp: false, updatedAt: null });
    const saved = await setChannelConsent(db(), tenantA, s.customer.id, { sms: true, whatsapp: false });
    expect(saved).toMatchObject({ sms: true, whatsapp: false });
    expect(saved?.updatedAt).not.toBeNull();
    expect(await getChannelConsent(db(), tenantB, s.customer.id)).toBeNull();
    expect(await setChannelConsent(db(), tenantB, s.customer.id, { sms: true, whatsapp: true })).toBeNull();
    const [row] = await rt._db.db.select().from(schema.customers).where(eq(schema.customers.id, s.customer.id));
    expect(row?.consentSms).toBe(true);
    expect(row?.consentWhatsapp).toBe(false);
  });

  it("the profile reports verified flags", async () => {
    const s = await signIn(tenantA, "9100000008");
    const p = await getCustomerProfile(db(), tenantA, s.customer.id);
    expect(p?.phoneVerified).toBe(true);
    expect(p?.emailVerified).toBe(false);
  });
});
