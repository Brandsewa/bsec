/**
 * Pure term pricing for promotions (owner decisions 2026-10-17, ADR-035). No database, no tax: GST is off for now.
 *
 * A subscription is prepaid for a term of 6, 12 or 36 months. A promotion discounts at most the first 12 months of
 * that term, and never more months than the term has; every other month is charged at the plan's list price.
 */

export const TERM_OPTIONS = [6, 12, 36] as const;
export type TermMonths = (typeof TERM_OPTIONS)[number];
export const MAX_PROMO_MONTHS = 12;

export type PromotionKind = "percent_off" | "free_months";

export interface PromotionTerms {
  kind: PromotionKind;
  /** 1 to 100 for percent_off. Ignored for free_months. */
  percentOff?: number | null | undefined;
  /** How many months the promotion lasts, 1 to 12. */
  durationMonths: number;
}

export interface QuoteLine {
  /** First month of the line, counting from 1. */
  fromMonth: number;
  toMonth: number;
  months: number;
  /** What one month costs on this line, in paise. */
  monthlyPaise: number;
  label: string;
}

export interface TermQuote {
  termMonths: number;
  listTotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  /** GST is not charged for now (owner decision), so tax is always 0. Kept so invoices can add it later. */
  taxPaise: 0;
  lines: QuoteLine[];
}

export function isValidTerm(months: number): months is TermMonths {
  return (TERM_OPTIONS as readonly number[]).includes(months);
}

/** Checks a promotion's terms; returns a plain-language problem or null. */
export function promotionProblem(p: PromotionTerms): string | null {
  if (!Number.isInteger(p.durationMonths) || p.durationMonths < 1 || p.durationMonths > MAX_PROMO_MONTHS) {
    return `A promotion can last 1 to ${MAX_PROMO_MONTHS} months`;
  }
  if (p.kind === "percent_off") {
    if (!Number.isInteger(p.percentOff ?? Number.NaN) || (p.percentOff as number) < 1 || (p.percentOff as number) > 100) {
      return "The discount must be a whole percentage from 1 to 100";
    }
  } else if (p.kind !== "free_months") {
    return "Unknown promotion type";
  }
  return null;
}

/** What one promoted month costs. */
export function promotedMonthlyPaise(listMonthlyPaise: number, p: PromotionTerms): number {
  if (p.kind === "free_months") return 0;
  return Math.round((listMonthlyPaise * (100 - (p.percentOff ?? 0))) / 100);
}

export function quoteTerm(input: { monthlyPricePaise: number; termMonths: number; promotion?: PromotionTerms | null | undefined }): TermQuote {
  const { monthlyPricePaise, termMonths } = input;
  if (!isValidTerm(termMonths)) throw new Error("Bad Request: choose a term of 6, 12 or 36 months");
  if (!Number.isInteger(monthlyPricePaise) || monthlyPricePaise < 0) throw new Error("Bad Request: the plan price must be zero or more");

  const promo = input.promotion ?? null;
  if (promo) {
    const problem = promotionProblem(promo);
    if (problem) throw new Error(`Bad Request: ${problem}`);
  }
  const promoMonths = promo ? Math.min(promo.durationMonths, MAX_PROMO_MONTHS, termMonths) : 0;
  const lines: QuoteLine[] = [];
  if (promo && promoMonths > 0) {
    const monthly = promotedMonthlyPaise(monthlyPricePaise, promo);
    lines.push({
      fromMonth: 1,
      toMonth: promoMonths,
      months: promoMonths,
      monthlyPaise: monthly,
      label: promo.kind === "free_months" ? "Free" : `${promo.percentOff}% off`,
    });
  }
  const listMonths = termMonths - promoMonths;
  if (listMonths > 0) {
    lines.push({ fromMonth: promoMonths + 1, toMonth: termMonths, months: listMonths, monthlyPaise: monthlyPricePaise, label: "List price" });
  }

  const totalPaise = lines.reduce((sum, l) => sum + l.monthlyPaise * l.months, 0);
  const listTotalPaise = monthlyPricePaise * termMonths;
  return { termMonths, listTotalPaise, discountPaise: listTotalPaise - totalPaise, totalPaise, taxPaise: 0, lines };
}

/** Adds whole calendar months, keeping the day where it exists (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** Normalises a promo code the way it is stored and entered: trimmed, upper case, letters, digits and dashes. */
export function normalizePromoCode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(code)) throw new Error("Bad Request: a promo code is 3 to 32 letters, numbers or dashes");
  return code;
}
