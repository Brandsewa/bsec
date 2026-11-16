import { afterAll, describe, expect, it } from "vitest";
import { createLogger, createRuntime } from "@bs/domain";
import { createApp } from "../src/app.ts";

// Points at a closed port: proves /health reports the DB as down (503) instead of crashing.
const rt = createRuntime({ service: "platform", databaseUrl: "postgres://x:y@127.0.0.1:1/none", poolMax: 1 });
const app = createApp(rt, createLogger("platform-test"));

afterAll(() => rt.close());

describe("platform app", () => {
  it("returns 503 from /health when the database is unreachable, with a request id", async () => {
    const res = await app.request("/health", { headers: { "x-request-id": "test-request-0001" } });
    expect(res.status).toBe(503);
    expect(res.headers.get("x-request-id")).toBe("test-request-0001");
    expect(await res.json()).toMatchObject({ service: "platform", db: { ok: false } });
  });

  // Audit A7-01: the API answers with browser hardening headers.
  it("sets security headers on every response", async () => {
    const res = await app.request("/system/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBeTruthy();
    expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  // Audit A5-01: a request body is capped while it streams.
  it("refuses a request body over the limit with 413 and still serves normal ones", async () => {
    const big = "x".repeat(7 * 1024 * 1024);
    const res = await app.request("/platform/tenants", { method: "POST", headers: { "content-type": "application/json" }, body: big });
    expect(res.status).toBe(413);
    expect((await app.request("/system/health")).status).toBe(200);
  });

  it("serves the oRPC OpenAPI route", async () => {
    const res = await app.request("/system/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", service: "platform" });
  });

  it("rejects unauthorized access to /platform/tenants", async () => {
    const res = await app.request("/platform/tenants");
    // Should fail authorization with error status
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
