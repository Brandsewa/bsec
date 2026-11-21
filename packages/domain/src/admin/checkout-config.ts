/**
 * Checkout configuration parser & serializer (PLAN §5.1 / Settings Phase 4).
 * Reads and writes the `store_settings.checkout` JSON group with schema version v: 1.
 * Preserves legacy and untouched keys (`cod`, `tax`) for backward compatibility with other phases.
 */

export interface AbandonedCheckoutStepConfig {
  delayHours: number;
}

/** A payment card logo (Visa, UPI...) the merchant uploaded, shown on the right of the payment option. */
export interface PaymentLogoConfig {
  url: string;
  alt: string;
}

/** What shoppers read on a payment option. Empty strings mean "use the built-in wording". */
export interface PaymentOptionDisplayConfig {
  title: string;
  subtitle: string;
  logos: PaymentLogoConfig[];
}

/** Wording of the checkout's shipping and payment sections, editable per store. */
export interface CheckoutDisplayConfig {
  shippingTitle: string;
  /** Shown instead of "Free" on a zero-cost shipping option. */
  shippingFreeLabel: string;
  paymentTitle: string;
  /** Keyed by provider (cod, razorpay, stripe, paypal, cashfree). */
  payment: Record<string, PaymentOptionDisplayConfig>;
}

export const PAYMENT_PROVIDER_KEYS = ["cod", "razorpay", "stripe", "paypal", "cashfree"] as const;
export const MAX_PAYMENT_LOGOS = 6;

export interface CheckoutSettingsConfig {
  v: 1;
  guestCheckout: boolean;
  accountCreation: "none" | "after_completed_order";
  phoneRequired: boolean;
  addressLine2: "hidden" | "optional";
  companyName: "hidden" | "optional";
  marketingEmail: {
    enabled: boolean;
    label: string;
  };
  termsConsent?: {
    enabled: boolean;
  } | undefined;
  abandoned: {
    detectAfterMinutes: number;
    recoveryEnabled: boolean;
    steps: AbandonedCheckoutStepConfig[];
  };
  display: CheckoutDisplayConfig;
  updatedAt?: string | undefined;
}

export const DEFAULT_CHECKOUT_DISPLAY: CheckoutDisplayConfig = {
  shippingTitle: "Shipping Method",
  shippingFreeLabel: "Free",
  paymentTitle: "Payment Method",
  payment: {},
};

/** A logo URL must be https, a path on this site, or localhost in development: never a data: or javascript: URL. */
export function isSafeLogoUrl(url: string): boolean {
  return /^https:\/\/[^\s]+$/i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s]*$/i.test(url) || /^\/[^\s/][^\s]*$/.test(url);
}

function cleanText(v: unknown, max: number, fallback: string): string {
  return typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : fallback;
}

export function parseCheckoutDisplay(raw: unknown): CheckoutDisplayConfig {
  const d = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const payment: Record<string, PaymentOptionDisplayConfig> = {};
  const rawPayment = (d.payment && typeof d.payment === "object" && !Array.isArray(d.payment) ? d.payment : {}) as Record<string, unknown>;
  for (const provider of PAYMENT_PROVIDER_KEYS) {
    const p = rawPayment[provider];
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const logos: PaymentLogoConfig[] = [];
    for (const l of Array.isArray(o.logos) ? o.logos : []) {
      if (!l || typeof l !== "object") continue;
      const url = typeof (l as Record<string, unknown>).url === "string" ? ((l as Record<string, unknown>).url as string).trim() : "";
      if (!url || !isSafeLogoUrl(url)) continue;
      logos.push({ url: url.slice(0, 2000), alt: cleanText((l as Record<string, unknown>).alt, 80, "") });
      if (logos.length >= MAX_PAYMENT_LOGOS) break;
    }
    const title = cleanText(o.title, 80, "");
    const subtitle = cleanText(o.subtitle, 160, "");
    if (title || subtitle || logos.length > 0) payment[provider] = { title, subtitle, logos };
  }
  return {
    shippingTitle: cleanText(d.shippingTitle, 80, DEFAULT_CHECKOUT_DISPLAY.shippingTitle),
    shippingFreeLabel: cleanText(d.shippingFreeLabel, 40, DEFAULT_CHECKOUT_DISPLAY.shippingFreeLabel),
    paymentTitle: cleanText(d.paymentTitle, 80, DEFAULT_CHECKOUT_DISPLAY.paymentTitle),
    payment,
  };
}

export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettingsConfig = {
  v: 1,
  guestCheckout: true,
  accountCreation: "after_completed_order",
  phoneRequired: true,
  addressLine2: "optional",
  companyName: "hidden",
  marketingEmail: {
    enabled: false,
    label: "Keep me updated on news and exclusive offers",
  },
  termsConsent: {
    enabled: false,
  },
  abandoned: {
    detectAfterMinutes: 60,
    recoveryEnabled: false,
    steps: [],
  },
  display: DEFAULT_CHECKOUT_DISPLAY,
};

/**
 * Parses raw JSON from `store_settings.checkout`.
 * If any setting is omitted, falls back to default preserving today's behavior.
 */
export function parseCheckoutSettings(raw: unknown, updatedAt?: Date | null): CheckoutSettingsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ...DEFAULT_CHECKOUT_SETTINGS,
      updatedAt: updatedAt ? updatedAt.toISOString() : undefined,
    };
  }

  const c = raw as Record<string, unknown>;

  const guestCheckout = typeof c.guestCheckout === "boolean" ? c.guestCheckout : DEFAULT_CHECKOUT_SETTINGS.guestCheckout;
  const accountCreation =
    c.accountCreation === "none" || c.accountCreation === "after_completed_order"
      ? c.accountCreation
      : DEFAULT_CHECKOUT_SETTINGS.accountCreation;
  const phoneRequired = typeof c.phoneRequired === "boolean" ? c.phoneRequired : DEFAULT_CHECKOUT_SETTINGS.phoneRequired;
  const addressLine2 =
    c.addressLine2 === "hidden" || c.addressLine2 === "optional"
      ? c.addressLine2
      : DEFAULT_CHECKOUT_SETTINGS.addressLine2;
  const companyName =
    c.companyName === "hidden" || c.companyName === "optional"
      ? c.companyName
      : DEFAULT_CHECKOUT_SETTINGS.companyName;

  // marketingEmail
  const rawMarketing = (c.marketingEmail && typeof c.marketingEmail === "object" ? c.marketingEmail : {}) as Record<string, unknown>;
  const marketingEmail = {
    enabled: typeof rawMarketing.enabled === "boolean" ? rawMarketing.enabled : DEFAULT_CHECKOUT_SETTINGS.marketingEmail.enabled,
    label:
      typeof rawMarketing.label === "string" && rawMarketing.label.trim().length > 0
        ? rawMarketing.label.trim().slice(0, 120)
        : DEFAULT_CHECKOUT_SETTINGS.marketingEmail.label,
  };

  // abandoned checkout
  const rawAbandoned = (c.abandoned && typeof c.abandoned === "object" ? c.abandoned : {}) as Record<string, unknown>;
  const detectAfterMinutes =
    typeof rawAbandoned.detectAfterMinutes === "number" && Number.isFinite(rawAbandoned.detectAfterMinutes)
      ? Math.max(15, Math.min(10080, Math.round(rawAbandoned.detectAfterMinutes)))
      : DEFAULT_CHECKOUT_SETTINGS.abandoned.detectAfterMinutes;
  const recoveryEnabled =
    typeof rawAbandoned.recoveryEnabled === "boolean" ? rawAbandoned.recoveryEnabled : DEFAULT_CHECKOUT_SETTINGS.abandoned.recoveryEnabled;

  const rawSteps = Array.isArray(rawAbandoned.steps) ? rawAbandoned.steps : [];
  const steps: AbandonedCheckoutStepConfig[] = [];
  for (const s of rawSteps) {
    if (s && typeof s === "object") {
      const delay = (s as Record<string, unknown>).delayHours;
      if (typeof delay === "number" && Number.isFinite(delay) && delay >= 1 && delay <= 720) {
        steps.push({ delayHours: Math.round(delay) });
      }
    }
  }
  // Sort ascending, capped at 3 steps
  steps.sort((a, b) => a.delayHours - b.delayHours);
  const cappedSteps = steps.slice(0, 3);

  return {
    v: 1,
    guestCheckout,
    accountCreation,
    phoneRequired,
    addressLine2,
    companyName,
    marketingEmail,
    termsConsent: {
      enabled:
        typeof (c.termsConsent as Record<string, unknown> | undefined)?.enabled === "boolean"
          ? Boolean((c.termsConsent as Record<string, unknown>).enabled)
          : false,
    },
    abandoned: {
      detectAfterMinutes,
      recoveryEnabled,
      steps: cappedSteps,
    },
    display: parseCheckoutDisplay(c.display),
    updatedAt: updatedAt ? updatedAt.toISOString() : undefined,
  };
}
