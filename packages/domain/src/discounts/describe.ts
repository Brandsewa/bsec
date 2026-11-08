import { formatMoney } from "@bs/contracts/money";
import { parseDiscountAppliesTo, parseDiscountRules } from "@bs/contracts/discount-rules";

/** The parts of a discount the wording needs. */
export interface DescribableDiscount {
  type: string;
  value: number;
  minSubtotal: number | null;
  appliesTo: unknown;
  rules: unknown;
}

/**
 * A discount in a few words for a shopper: "Buy 2 Get 1 Free", "Spend ₹2,000, get Dalle free", "10% off on orders over ₹999",
 * "Free shipping on orders over ₹999". `giftTitle` names the free product of a spend offer when there is one.
 */
export function offerHeadline(d: DescribableDiscount, currency: string, giftTitle?: string): string {
  const money = (n: number) => formatMoney(n, currency);
  const rules = parseDiscountRules(d.rules);
  const over = d.minSubtotal && d.minSubtotal > 0 ? ` on orders over ${money(d.minSubtotal)}` : "";

  if (d.type === "buy_x_get_y" && rules.bxgy) {
    const b = rules.bxgy;
    const what = b.get.effect === "free" ? "Free" : b.get.effect === "percent" ? `at ${b.get.value ?? 0}% off` : `at ${money(b.get.value ?? 0)}`;
    return b.buy.trigger === "amount"
      ? `Spend ${money(b.buy.value)}, get ${giftTitle ?? `${b.get.quantity} item${b.get.quantity === 1 ? "" : "s"}`} ${b.get.effect === "free" ? "free" : what}`
      : `Buy ${b.buy.value} Get ${b.get.quantity} ${what}`;
  }
  if (d.type === "bundle" && rules.bundle) return `Any ${rules.bundle.quantity} for ${money(rules.bundle.price)}`;
  if (d.type === "free_shipping") return `Free shipping${over}`;

  const scoped = parseDiscountAppliesTo(d.appliesTo)?.type !== "all" ? " on selected items" : "";
  const top = rules.tiers ? Math.max(...rules.tiers.map((t) => t.value)) : null;
  if (d.type === "percent") return top !== null ? `Up to ${top}% off${scoped}: spend more, save more` : `${d.value}% off${scoped}${over}`;
  if (d.type === "fixed") return top !== null ? `Up to ${money(top)} off${scoped}: spend more, save more` : `${money(d.value)} off${scoped}${over}`;
  return "Special offer";
}
