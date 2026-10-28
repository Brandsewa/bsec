/**
 * Small price formatter for client bundles. The product page's JavaScript has about 10 bytes of headroom under its 50 KB gzip
 * budget (apps/web/test/perf-budget-bundle.int.test.ts), so client components use this instead of `formatMoney` from
 * `@bs/contracts/money`. It gives the same text for INR, USD, CAD and JPY ("₹1,299", "₹1,299.50", "$12.50").
 */
export function formatMinor(minor: number | bigint, currency: string, locale: string): string {
  const v = Number(minor) / (currency === "JPY" ? 1 : 100);
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: v % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(v);
}
