import { describe, expect, it } from "vitest";
import { addMonths, normalizePromoCode, promotionProblem, quoteTerm } from "../src/saas/promotion-math.ts";

const monthly = 249_900; // Growth, in paise

describe("term quotes", () => {
  it("charges list price for the whole term without a promotion", () => {
    const q = quoteTerm({ monthlyPricePaise: monthly, termMonths: 6 });
    expect(q).toMatchObject({ termMonths: 6, listTotalPaise: monthly * 6, discountPaise: 0, totalPaise: monthly * 6, taxPaise: 0 });
    expect(q.lines).toEqual([{ fromMonth: 1, toMonth: 6, months: 6, monthlyPaise: monthly, label: "List price" }]);
  });

  it("a free year on a 12-month term costs nothing and a 36-month term pays list price for the other two years", () => {
    expect(quoteTerm({ monthlyPricePaise: monthly, termMonths: 12, promotion: { kind: "free_months", durationMonths: 12 } }).totalPaise).toBe(0);
    const three = quoteTerm({ monthlyPricePaise: monthly, termMonths: 36, promotion: { kind: "free_months", durationMonths: 12 } });
    expect(three.totalPaise).toBe(monthly * 24);
    expect(three.discountPaise).toBe(monthly * 12);
    expect(three.lines.map((l) => [l.fromMonth, l.toMonth, l.monthlyPaise])).toEqual([[1, 12, 0], [13, 36, monthly]]);
  });

  it("applies a percentage only to the first promoted months, and never past the term", () => {
    const half = quoteTerm({ monthlyPricePaise: 100_000, termMonths: 36, promotion: { kind: "percent_off", percentOff: 50, durationMonths: 12 } });
    expect(half.totalPaise).toBe(50_000 * 12 + 100_000 * 24);
    // a 12-month promotion on a 6-month term only covers the 6 months
    const short = quoteTerm({ monthlyPricePaise: 100_000, termMonths: 6, promotion: { kind: "percent_off", percentOff: 25, durationMonths: 12 } });
    expect(short.totalPaise).toBe(75_000 * 6);
    expect(short.lines).toHaveLength(1);
    // rounding is per month, in paise
    expect(quoteTerm({ monthlyPricePaise: 99_901, termMonths: 6, promotion: { kind: "percent_off", percentOff: 33, durationMonths: 3 } }).lines[0]!.monthlyPaise).toBe(66_934);
  });

  it("rejects bad terms and promotions", () => {
    expect(() => quoteTerm({ monthlyPricePaise: monthly, termMonths: 9 })).toThrow(/6, 12 or 36/);
    expect(() => quoteTerm({ monthlyPricePaise: -1, termMonths: 6 })).toThrow(/zero or more/);
    expect(promotionProblem({ kind: "percent_off", percentOff: 0, durationMonths: 3 })).toMatch(/1 to 100/);
    expect(promotionProblem({ kind: "percent_off", percentOff: 101, durationMonths: 3 })).toMatch(/1 to 100/);
    expect(promotionProblem({ kind: "free_months", durationMonths: 13 })).toMatch(/1 to 12 months/);
    expect(promotionProblem({ kind: "free_months", durationMonths: 12 })).toBeNull();
    expect(() => quoteTerm({ monthlyPricePaise: monthly, termMonths: 12, promotion: { kind: "percent_off", percentOff: null, durationMonths: 3 } })).toThrow(/percentage/);
  });
});

describe("dates and codes", () => {
  it("adds calendar months without overflowing short months", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addMonths(new Date("2028-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2028-02-29");
    expect(addMonths(new Date("2026-10-17T10:00:00Z"), 12).toISOString()).toBe("2027-10-17T10:00:00.000Z");
  });

  it("normalises promo codes", () => {
    expect(normalizePromoCode("  launch 2026 ")).toBe("LAUNCH2026");
    expect(() => normalizePromoCode("ab")).toThrow(/3 to 32/);
    expect(() => normalizePromoCode("bad code!")).toThrow(/3 to 32/);
  });
});
