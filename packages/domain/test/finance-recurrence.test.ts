import { describe, expect, it } from "vitest";
import { addRecurringInterval, firstRecurringDue } from "@bs/contracts";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("recurring schedule maths (shared by server and admin preview)", () => {
  it("keeps the anchor day and clamps short months without drifting", () => {
    let d = new Date("2026-01-31T00:00:00.000Z");
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      d = addRecurringInterval(d, "monthly", 1, 31);
      seen.push(iso(d));
    }
    expect(seen).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("handles leap days, quarters, years and year rollover", () => {
    expect(iso(firstRecurringDue("2024-02-29", "yearly", 1))).toBe("2025-02-28");
    expect(iso(firstRecurringDue("2026-11-15", "quarterly", 1))).toBe("2027-02-15");
    expect(iso(firstRecurringDue("2026-12-10", "monthly", 1))).toBe("2027-01-10");
    expect(iso(firstRecurringDue("2026-01-15", "monthly", 2))).toBe("2026-03-15");
  });

  it("is timezone independent (UTC)", () => {
    expect(firstRecurringDue("2026-03-01", "monthly", 1).toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});
