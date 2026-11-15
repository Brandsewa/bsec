/**
 * Browser side of Stripe Embedded Checkout. Stripe.js is loaded only when a shopper reaches a Stripe payment (never on the
 * product pages), and only from Stripe's own host. The release train in the URL comes from the server and matches the
 * pinned API version, because the embedded method was renamed in a later train.
 */
export interface StripeEmbeddedParams {
  clientSecret: string;
  publishableKey: string;
  jsUrl: string;
}

interface EmbeddedCheckoutInstance {
  mount(target: HTMLElement): void;
  destroy(): void;
}
interface StripeInstance {
  initEmbeddedCheckout(opts: { clientSecret: string }): Promise<EmbeddedCheckoutInstance>;
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

/** Mounts Stripe's form into `target`. Returns a function that removes it. */
export async function mountStripeEmbedded(params: StripeEmbeddedParams, target: HTMLElement): Promise<() => void> {
  const Stripe = await loadStripeJs(params.jsUrl);
  const checkout = await Stripe(params.publishableKey).initEmbeddedCheckout({ clientSecret: params.clientSecret });
  checkout.mount(target);
  return () => checkout.destroy();
}
