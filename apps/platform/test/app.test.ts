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

  it("serves the oRPC OpenAPI route", async () => {
    const res = await app.request("/system/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", service: "platform" });
  });
});
