import { describe, expect, it } from "vitest";
import type { Db } from "@bs/db";
import { createPlatformAuth, createStaffAuth, googleConfigFingerprint } from "../src/index.ts";

// Minimal mock DB satisfying the Drizzle adapter structure (same approach as auth.test.ts).
const mockDb = {
  select: () => mockDb,
  from: () => mockDb,
  where: () => mockDb,
  limit: () => mockDb,
  insert: () => mockDb,
  values: () => mockDb,
  returning: () => Promise.resolve([]),
  update: () => mockDb,
  set: () => mockDb,
  delete: () => mockDb,
  transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(mockDb),
} as unknown as Db;

const SECRET = "test-secret-at-least-32-characters-long-12345";
const cfg = { clientId: "123456789012-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-test" };

describe("Google sign-in wiring", () => {
  it("fingerprints the config so apps can rebuild the instance when it changes", () => {
    expect(googleConfigFingerprint(null)).toBe("off");
    expect(googleConfigFingerprint(cfg)).not.toBe(googleConfigFingerprint({ ...cfg, clientSecret: "GOCSPX-other" }));
  });

  it("registers Google on the staff and platform instances when a loader is given", async () => {
    for (const make of [createStaffAuth, createPlatformAuth]) {
      const auth = make(mockDb, { baseURL: "http://localhost:3000", secret: SECRET, loadGoogle: async () => cfg });
      const ctx = await auth.$context;
      expect(ctx.socialProviders.map((p: { id: string }) => p.id)).toEqual(["google"]);
      // Linking an unverified local account is allowed only through googleAccountLinkGuard (password and sessions removed).
      expect(auth.options.account?.accountLinking?.requireLocalEmailVerified).toBe(false);
    }
  });

  it("has no Google provider when the platform client is off or not configured", async () => {
    const off = createStaffAuth(mockDb, { baseURL: "http://localhost:3000", secret: SECRET, loadGoogle: async () => null });
    expect((await off.$context).socialProviders).toHaveLength(0);
    const none = createPlatformAuth(mockDb, { baseURL: "http://localhost:4000", secret: SECRET });
    expect((await none.$context).socialProviders).toHaveLength(0);
  });

  it("never signs a new person up through the social endpoint (implicit sign-up is off)", async () => {
    const auth = createStaffAuth(mockDb, { baseURL: "http://localhost:3000", secret: SECRET, loadGoogle: async () => cfg });
    const provider = (await auth.$context).socialProviders[0] as { disableImplicitSignUp?: boolean };
    expect(provider.disableImplicitSignUp).toBe(true);
  });
});
