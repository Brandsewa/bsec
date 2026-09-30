import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { verifyTurnstileToken } from "../src/saas/abuse-protection.ts";

describe("S2: Turnstile Fail-Closed & Non-Production Bypass", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("fails closed in production when TURNSTILE_SECRET_KEY is unconfigured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.TURNSTILE_SECRET_KEY;

    const result = await verifyTurnstileToken("some-token", "1.2.3.4");
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/not configured/i);
  });

  it("fails closed in production even when cf-turnstile-bypass is provided", async () => {
    process.env.NODE_ENV = "production";
    process.env.TURNSTILE_SECRET_KEY = "dummy-secret-prod";

    const result = await verifyTurnstileToken("cf-turnstile-bypass", "1.2.3.4");
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/bypass is disabled in production|invalid/i);
  });

  it("allows cf-turnstile-bypass in non-production environments", async () => {
    process.env.NODE_ENV = "test";
    process.env.TURNSTILE_SECRET_KEY = "any-key";

    const result = await verifyTurnstileToken("cf-turnstile-bypass", "127.0.0.1");
    expect(result.success).toBe(true);
  });
});
