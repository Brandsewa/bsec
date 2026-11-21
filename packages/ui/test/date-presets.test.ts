import { describe, expect, it } from "vitest";
import { ANALYTICS_PRESETS, autoGranularity, comparisonRange } from "../src/lib/date-presets.ts";

const d = (s: string) => new Date(`${s}T00:00:00`);
const iso = (x: Date) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
const preset = (id: string, today: string) => {
  const r = ANALYTICS_PRESETS.find((p) => p.id === id)!.range(d(today));
  return [iso(r.from), iso(r.to)];
};

describe("analytics date presets", () => {
  it("resolves year to date, last month and last quarter against the given today", () => {
    expect(preset("year-to-date", "2026-11-15")).toEqual(["2026-01-01", "2026-11-15"]);
    expect(preset("last-month", "2026-03-10")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(preset("last-quarter", "2026-11-15")).toEqual(["2026-07-01", "2026-09-30"]);
    expect(preset("last-7", "2026-11-15")).toEqual(["2026-11-09", "2026-11-15"]);
  });

  it("uses the supplied today, so the store's timezone decides the day", () => {
    expect(preset("today", "2026-01-01")).toEqual(["2026-01-01", "2026-01-01"]);
  });
});

describe("comparisonRange", () => {
  const range = { from: d("2026-11-01"), to: d("2026-11-15") };

  it("previous period is the same number of days straight before", () => {
    const c = comparisonRange(range, "previous-period")!;
    expect([iso(c.from), iso(c.to)]).toEqual(["2026-10-17", "2026-10-31"]);
  });

  it("previous year is the same dates a year earlier", () => {
    const c = comparisonRange(range, "previous-year")!;
    expect([iso(c.from), iso(c.to)]).toEqual(["2025-11-01", "2025-11-15"]);
  });

  it("none gives no comparison", () => {
    expect(comparisonRange(range, "none")).toBeNull();
  });
});

describe("autoGranularity", () => {
  it("picks day, week, month by length", () => {
    expect(autoGranularity({ from: d("2026-11-01"), to: d("2026-11-15") })).toBe("day");
    expect(autoGranularity({ from: d("2026-08-01"), to: d("2026-11-15") })).toBe("week");
    expect(autoGranularity({ from: d("2026-01-01"), to: d("2026-11-15") })).toBe("month");
  });
});
