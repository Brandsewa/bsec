/**
 * Browser side of Stripe's Payment Element (ADR-047). Stripe.js is loaded only when a shopper reaches a Stripe payment (never
 * on the product pages), and only from Stripe's own host. The release train in the URL comes from the server and matches the
 * pinned API version. Card details live in Stripe's own iframe; this code only sees "valid" or an error message.
 */
export interface StripeConfig {
  publishableKey: string;
  jsUrl: string;
}

/** A payment that already exists on the server (Pay now, or a retry): confirmed with its client secret. */
export interface StripePaymentParams extends StripeConfig {
  clientSecret: string;
}

interface PaymentElementInstance {
  mount(target: HTMLElement): void;
  destroy(): void;
}
interface ElementsInstance {
  create(type: "payment", options?: Record<string, unknown>): PaymentElementInstance;
  submit(): Promise<{ error?: { message?: string } }>;
  update(options: { amount?: number }): void;
}
interface StripeInstance {
  elements(options: Record<string, unknown>): ElementsInstance;
  confirmPayment(options: { elements: ElementsInstance; clientSecret?: string; confirmParams: { return_url: string } }): Promise<{ error?: { message?: string } }>;
}
type StripeFactory = (publishableKey: string) => StripeInstance;

const STRIPE_JS_PREFIX = "https://js.stripe.com/";

let loading: Promise<StripeFactory> | null = null;

function loadStripeJs(url: string): Promise<StripeFactory> {
  if (!url.startsWith(STRIPE_JS_PREFIX)) return Promise.reject(new Error("The payment form could not be loaded."));
  const w = window as unknown as { Stripe?: StripeFactory };
  if (w.Stripe) return Promise.resolve(w.Stripe);
  if (loading) return loading;
  loading = new Promise<StripeFactory>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = url;
    el.async = true;
    el.onload = () => (w.Stripe ? resolve(w.Stripe) : reject(new Error("Stripe did not load")));
    el.onerror = () => {
      loading = null;
      reject(new Error("Could not load the payment form. Check your connection and try again."));
    };
    document.head.appendChild(el);
  });
  return loading;
}

/** What the page can do with a mounted Payment Element. Both calls return an error message for the shopper, or null. */
export interface StripePaymentApi {
  /** Checks what the shopper typed (before the order is placed). Deferred mode only; a no-op otherwise. */
  validate(): Promise<string | null>;
  /** Confirms the payment. Stripe then sends the window to `returnUrl`, so on success this does not return to the page. */
  pay(clientSecret: string | null, returnUrl: string): Promise<string | null>;
  /** Keeps the amount Stripe shows in step with the order total (deferred mode). */
  setAmount(amount: number): void;
  destroy(): void;
}

export type StripeMount = { kind: "deferred"; amount: number; currency: string } | { kind: "secret"; clientSecret: string };

/** Mounts the Payment Element into `target`. */
export async function mountStripePayment(config: StripeConfig, mode: StripeMount, target: HTMLElement): Promise<StripePaymentApi> {
  const Stripe = await loadStripeJs(config.jsUrl);
  const stripe = Stripe(config.publishableKey);
  const appearance = { theme: "stripe", variables: { borderRadius: "8px", fontFamily: "inherit" } };
  const elements =
    mode.kind === "deferred"
      ? stripe.elements({ mode: "payment", amount: mode.amount, currency: mode.currency.toLowerCase(), appearance })
      : stripe.elements({ clientSecret: mode.clientSecret, appearance });
  const element = elements.create("payment", { layout: "accordion" });
  element.mount(target);
  return {
    async validate() {
      if (mode.kind !== "deferred") return null;
      const { error } = await elements.submit();
      return error ? (error.message ?? "Please check your payment details.") : null;
    },
    async pay(clientSecret, returnUrl) {
      const { error } = await stripe.confirmPayment({ elements, ...(clientSecret ? { clientSecret } : {}), confirmParams: { return_url: returnUrl } });
      return error ? (error.message ?? "The payment could not be completed. Please try again.") : null;
    },
    setAmount(amount) {
      if (mode.kind === "deferred") elements.update({ amount });
    },
    destroy() {
      element.destroy();
    },
  };
}
