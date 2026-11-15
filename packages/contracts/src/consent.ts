import { z } from "zod";

/**
 * Cookie consent and optional tracking integrations (docs/ANALYTICS-PLAN.md slice 5, ADR-047, ADR-010).
 *
 * Merchants never add code. They switch the banner on, edit its wording from a fixed set of fields, and paste a GA4 measurement
 * ID or a Meta Pixel ID. The IDs are validated against strict patterns here and the storefront loader is first-party, so an ID can
 * never carry script. Integrations load only after the visitor accepts the matching category; the store's own cookieless analytics
 * (ADR-047) is unaffected by this choice.
 */

export const CONSENT_POSITIONS = ["bottom", "bottom-left", "bottom-right", "center"] as const;
export type ConsentPosition = (typeof CONSENT_POSITIONS)[number];

export const GA4_ID = /^G-[A-Z0-9]{4,14}$/;
export const META_PIXEL_ID = /^[0-9]{8,20}$/;
/** The "Test events" code shown in Meta Events Manager, e.g. TEST12345. Not a secret. */
export const META_TEST_EVENT_CODE = /^[A-Z0-9]{3,20}$/;

const text = (max: number) => z.string().trim().min(1).max(max);

export const ConsentSettings = z.object({
  /** The banner. Required (and refused to switch off) while any integration below is set. */
  enabled: z.boolean(),
  position: z.enum(CONSENT_POSITIONS),
  title: text(80),
  message: text(400),
  acceptLabel: text(30),
  rejectLabel: text(30),
  customizeLabel: text(30),
  /** Slug of the store's privacy policy page, linked from the banner. Empty = no link. */
  policyPath: z.string().trim().max(120).regex(/^(\/[a-zA-Z0-9\-_/]*)?$/, "Use a path on this store, like /policies/privacy").default(""),
  integrations: z.object({
    /** Analytics category. e.g. G-ABC123XYZ */
    ga4MeasurementId: z.string().trim().regex(GA4_ID, "Use the format G-XXXXXXXXXX").nullable(),
    /** Marketing category. The numeric Pixel ID. */
    metaPixelId: z.string().trim().regex(META_PIXEL_ID, "Use the numeric Pixel ID (8 to 20 digits)").nullable(),
    /** Marks server-side Meta events as test traffic while the merchant checks them in Events Manager. */
    metaTestEventCode: z.string().trim().regex(META_TEST_EVENT_CODE, "Use the test code from Meta Events Manager").nullable().default(null),
  }),
});
export type ConsentSettings = z.infer<typeof ConsentSettings>;

export const DEFAULT_CONSENT_SETTINGS: ConsentSettings = {
  enabled: false,
  position: "bottom",
  title: "We value your privacy",
  message: "We use cookies to make this store work, and, only if you agree, to understand how it is used and to show relevant offers.",
  acceptLabel: "Accept all",
  rejectLabel: "Reject non-essential",
  customizeLabel: "Choose",
  policyPath: "",
  integrations: { ga4MeasurementId: null, metaPixelId: null, metaTestEventCode: null },
};

/** Reads whatever is stored (null, an older shape, junk) into a complete, valid settings object. */
export function normalizeConsentSettings(raw: unknown): ConsentSettings {
  const parsed = ConsentSettings.safeParse({ ...DEFAULT_CONSENT_SETTINGS, ...(typeof raw === "object" && raw !== null ? raw : {}) });
  return parsed.success ? parsed.data : DEFAULT_CONSENT_SETTINGS;
}

/** True when the store has any integration that sets cookies, so the banner is required. */
export function hasConsentIntegrations(c: ConsentSettings): boolean {
  return Boolean(c.integrations.ga4MeasurementId || c.integrations.metaPixelId);
}

/** What the storefront script receives. Contains only what the banner needs; nothing private. */
export interface PublicConsentConfig {
  v: 1;
  /** Bumped when the wording or integrations change, so earlier choices are asked again. */
  rev: string;
  position: ConsentPosition;
  title: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
  customizeLabel: string;
  policyPath: string;
  ga4: string | null;
  pixel: string | null;
}
