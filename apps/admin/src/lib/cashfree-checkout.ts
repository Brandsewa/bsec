/**
 * Opens Cashfree's hosted subscription checkout (ADR-037). Cashfree's checkout is started with its own browser script, so
 * the script is loaded on demand, only when a merchant on Cashfree billing presses "Continue to payment". The server never
 * trusts anything this script reports: the plan only changes after Cashfree's signed webhook arrives.
 */
// The script's option is named `subsSessionId` (not the API's `subscription_session_id`): it answers "subsSessionId is missing in options" otherwise.
const SDK_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";

interface CashfreeInstance {
  subscriptionsCheckout(opts: { subsSessionId: string; redirectTarget?: "_self" | "_blank" | "_top" }): Promise<{ error?: { message?: string } } | undefined>;
}
type CashfreeFactory = (opts: { mode: "sandbox" | "production" }) => CashfreeInstance;

function loadSdk(): Promise<CashfreeFactory> {
  const existing = (window as unknown as { Cashfree?: CashfreeFactory }).Cashfree;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => {
      const factory = (window as unknown as { Cashfree?: CashfreeFactory }).Cashfree;
      if (factory) resolve(factory);
      else reject(new Error("Cashfree checkout could not start. Try again."));
    };
    script.onerror = () => reject(new Error("Could not load Cashfree checkout. Check your connection or ad blocker and try again."));
    document.head.appendChild(script);
  });
}

export async function openCashfreeCheckout(session: { sessionId: string; mode: "test" | "live" }): Promise<void> {
  const Cashfree = await loadSdk();
  const cashfree = Cashfree({ mode: session.mode === "live" ? "production" : "sandbox" });
  const result = await cashfree.subscriptionsCheckout({ subsSessionId: session.sessionId, redirectTarget: "_self" });
  if (result?.error) throw new Error(result.error.message ?? "Cashfree could not open the payment page.");
}
