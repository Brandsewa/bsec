/** Browser side of Razorpay checkout: loads Razorpay's script, opens its modal and reports the result to our server. */

export interface RazorpayParams {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  email: string;
  phone: string;
}

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (r: { error?: { description?: string } }) => void): void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadScript(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Razorpay did not load")));
    el.onerror = () => reject(new Error("Could not load the payment window. Check your connection and try again."));
    document.head.appendChild(el);
  });
}

export type RazorpayOutcome = { status: "paid" } | { status: "dismissed" } | { status: "failed"; message: string };

/** Opens the Razorpay modal for an order and resolves once the shopper paid (and our server verified it), closed it, or it failed. */
export async function payWithRazorpay(params: RazorpayParams, orderToken: string, storeName?: string): Promise<RazorpayOutcome> {
  const Razorpay = await loadScript();
  return new Promise<RazorpayOutcome>((resolve) => {
    let settled = false;
    const finish = (o: RazorpayOutcome) => {
      if (settled) return;
      settled = true;
      resolve(o);
    };
    const rzp = new Razorpay({
      key: params.keyId,
      order_id: params.orderId,
      amount: params.amount,
      currency: params.currency,
      name: storeName ?? "Order payment",
      description: `Order ${params.name}`,
      prefill: { email: params.email, contact: params.phone },
      handler: async (r: RazorpaySuccess) => {
        try {
          const res = await fetch("/api/storefront/checkout/razorpay/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderToken,
              razorpayOrderId: r.razorpay_order_id,
              razorpayPaymentId: r.razorpay_payment_id,
              razorpaySignature: r.razorpay_signature,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            // The money moved; the store's payment webhook may still confirm it, so the message says so.
            finish({ status: "failed", message: data.error ?? "We could not confirm your payment yet. If money was deducted, the order will update shortly." });
            return;
          }
          finish({ status: "paid" });
        } catch {
          finish({ status: "failed", message: "We could not confirm your payment yet. If money was deducted, the order will update shortly." });
        }
      },
      modal: { ondismiss: () => finish({ status: "dismissed" }) },
    });
    rzp.on("payment.failed", (r) => finish({ status: "failed", message: r.error?.description ?? "The payment did not go through. You can try again." }));
    rzp.open();
  });
}
