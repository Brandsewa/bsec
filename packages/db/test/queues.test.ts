import { describe, expect, it } from "vitest";
import { QUEUES, QUEUE_NAMES } from "../src/queues.ts";

describe("queue registry", () => {
  // A named queue that is not created breaks `boss.work`, and one failed `boss.schedule` stops every schedule after it.
  it("creates every named queue", () => {
    const created = QUEUES.map((q) => q.name as string);
    expect(Object.values(QUEUE_NAMES).filter((name) => !created.includes(name))).toEqual([]);
  });
});
