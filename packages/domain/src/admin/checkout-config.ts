/**
 * Checkout configuration parser & serializer (PLAN §5.1 / Settings Phase 4).
 * Reads and writes the `store_settings.checkout` JSON group with schema version v: 1.
 * Preserves legacy and untouched keys (`cod`, `tax`) for backward compatibility with other phases.
 */

export interface AbandonedCheckoutStepConfig {
  delayHours: number;
}

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
  updatedAt?: string | undefined;
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
    updatedAt: updatedAt ? updatedAt.toISOString() : undefined,
  };
}
