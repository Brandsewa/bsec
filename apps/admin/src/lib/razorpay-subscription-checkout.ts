/**
 * Opens Razorpay's checkout window for a subscription (card, UPI AutoPay or e-mandate) inside the admin app, instead of
 * sending the owner to Razorpay's hosted page. The script is loaded on demand, only when the owner presses "Continue to
 * payment". Nothing this window reports is trusted: the plan changes only after Razorpay's signed webhook arrives, so the
 * result here only decides what the page says next ("confirming" or nothing).
 */
const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (r: { error?: { description?: string } }) => void): void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

function loadScript(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Razorpay did not load")));
    el.onerror = () => reject(new Error("Could not load the payment window. Check your connection or ad blocker and try again."));
    document.head.appendChild(el);
  });
}

export type RazorpaySubscriptionOutcome = { status: "authorized" } | { status: "dismissed" } | { status: "failed"; message: string };

export async function openRazorpaySubscriptionCheckout(params: {
  keyId: string;
  subscriptionId: string;
  email?: string | undefined;
  name?: string | undefined;
}): Promise<RazorpaySubscriptionOutcome> {
  const Razorpay = await loadScript();
  return new Promise<RazorpaySubscriptionOutcome>((resolve) => {
    let settled = false;
    // Razorpay lets the payer retry inside the window, so a failed attempt is only reported if they then close it.
    let lastError: string | null = null;
    const finish = (o: RazorpaySubscriptionOutcome) => {
      if (settled) return;
      settled = true;
      resolve(o);
    };
    const rzp = new Razorpay({
      key: params.keyId,
      subscription_id: params.subscriptionId,
      name: "Brand Sewa",
      description: "Store plan subscription",
      ...(params.email || params.name ? { prefill: { ...(params.email ? { email: params.email } : {}), ...(params.name ? { name: params.name } : {}) } } : {}),
      handler: () => finish({ status: "authorized" }),
      modal: { ondismiss: () => finish(lastError ? { status: "failed", message: lastError } : { status: "dismissed" }) },
    });
    rzp.on("payment.failed", (r) => {
      lastError = r.error?.description ?? "The payment did not go through.";
    });
    rzp.open();
  });
}
