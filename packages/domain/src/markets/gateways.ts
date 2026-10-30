/**
 * Which gateway can charge in which currency (ADR-040 section 5). Pure, so the market editor, the readiness check and the
 * server-side checkout all use the same answer.
 */

/** Currencies PayPal can receive (PayPal REST currency codes; INR is not among them). */
export const PAYPAL_CURRENCIES: ReadonlySet<string> = new Set([
  "AUD", "BRL", "CAD", "CNY", "CZK", "DKK", "EUR", "HKD", "HUF", "ILS", "JPY", "MYR", "MXN", "TWD", "NZD", "NOK", "PHP", "PLN",
  "GBP", "SGD", "SEK", "CHF", "THB", "USD",
]);

export interface GatewayCurrencyCheck {
  /** Set when the gateway cannot be offered in this market at all. */
  blocking: string | null;
  /** Set when it may work but depends on the merchant's own gateway account being set up for it. */
  warning: string | null;
}

export function gatewayCurrencyCheck(input: {
  provider: string;
  currency: string;
  /** The merchant's country (the base market's country). */
  merchantCountry: string;
}): GatewayCurrencyCheck {
  const currency = input.currency.toUpperCase();
  const none: GatewayCurrencyCheck = { blocking: null, warning: null };
  switch (input.provider) {
    case "cod":
      return input.merchantCountry.toUpperCase() === "IN" && currency === "INR"
        ? none
        : { blocking: "Cash on delivery is only offered for INR orders in India.", warning: null };
    case "razorpay":
    case "cashfree":
      return currency === "INR"
        ? none
        : { blocking: null, warning: "Charging in a foreign currency needs international payments enabled on your account with this gateway." };
    case "stripe":
      return { blocking: null, warning: input.merchantCountry.toUpperCase() === "IN" ? "Stripe accounts in India are invite-only; use the account you were invited to." : null };
    case "paypal":
      return PAYPAL_CURRENCIES.has(currency) ? none : { blocking: `PayPal cannot charge in ${currency}.`, warning: null };
    default:
      return { blocking: `Unknown payment method ${input.provider}.`, warning: null };
  }
}
