import { describe, expect, it } from "vitest";
import { Health } from "../src/index.ts";

describe("Health contract", () => {
  it("accepts a valid payload and rejects unknown services", () => {
    const ok = { status: "ok", service: "web", version: "dev", db: { ok: true, role: "app_rw" } };
    expect(Health.parse(ok)).toEqual(ok);
    expect(() => Health.parse({ ...ok, service: "shop" })).toThrow();
  });
});
