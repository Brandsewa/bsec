import { describe, expect, it } from "vitest";
import { QUEUES, QUEUE_NAMES } from "@bs/db";

describe("Finance queue registration (docs/FINANCE-PLAN.md section 3.5)", () => {
  it("registers finance.post and finance.reconcile with retry options and unique names", () => {
    const names = QUEUES.map((q) => q.name);
    expect(new Set(names).size).toBe(names.length);

    for (const name of ["finance.post", "finance.reconcile"]) {
      const q = QUEUES.find((x) => x.name === name);
      expect(q, `${name} must be registered`).toBeDefined();
      expect(q?.options?.retryLimit).toBeGreaterThan(0);
    }
    expect(QUEUE_NAMES.FINANCE_POST).toBe("finance.post");
    expect(QUEUE_NAMES.FINANCE_RECONCILE).toBe("finance.reconcile");
  });
});
