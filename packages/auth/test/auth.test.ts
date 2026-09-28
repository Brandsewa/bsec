import { describe, expect, it } from "vitest";
import {
  CUSTOMER_COOKIE,
  STAFF_COOKIE_PREFIX,
  createCustomerAuth,
  createStaffAuth,
} from "../src/index.ts";

import type { Db } from "@bs/db";

describe("Better Auth instances", () => {
  // Minimal mock DB satisfying Drizzle adapter structure
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

  it("configures staff auth with bs-staff cookie prefix and staff tables", async () => {
    const staffAuth = createStaffAuth(mockDb, {
      baseURL: "http://localhost:3000",
      secret: "test-secret-at-least-32-characters-long-12345",
    });

    expect(staffAuth).toBeDefined();
    expect(staffAuth.options.advanced?.cookiePrefix).toBe(STAFF_COOKIE_PREFIX);

    const ctx = await staffAuth.$context;
    expect(ctx.authCookies?.sessionToken?.name).toMatch(new RegExp(`^${STAFF_COOKIE_PREFIX}\\.`));
  });

  it("configures customer auth with __Host-cust cookie and customer_sessions table", async () => {
    const customerAuth = createCustomerAuth(mockDb, {
      baseURL: "https://store1.example.com",
      secret: "test-secret-at-least-32-characters-long-12345",
    });

    expect(customerAuth).toBeDefined();
    const ctx = await customerAuth.$context;
    expect(ctx.authCookies?.sessionToken?.name).toBe(CUSTOMER_COOKIE);
  });
});
