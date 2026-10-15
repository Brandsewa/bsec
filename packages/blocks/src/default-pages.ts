import { z } from "zod";
import { ICON_NAMES } from "./common.ts";

/**
 * Editable copy and toggles for the theme's default pages (checkout, order success, payment failed, search, 404).
 * These pages are fixed storefront code, not block documents (ADR-032); a theme only changes their wording and a few
 * switches. Stored under `tokens.defaultPages` of the theme template and copied to the store with the other tokens,
 * so no migration is needed. Plain text only (ADR-010): angle brackets are rejected, the storefront renders it as text.
 */
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[<>]/.test(s), "Plain text only");

export const DefaultPagesSchema = z
  .object({
    checkout: z.object({
      heading: text(60),
      showTrustBadges: z.boolean(),
      note: text(200).or(z.literal("")),
    }),
    orderSuccess: z.object({
      heading: text(80),
      /** `{email}` is replaced with the shopper's email. */
      message: text(200),
      showCreateAccount: z.boolean(),
      continueLabel: text(40),
    }),
    paymentFailed: z.object({
      heading: text(80),
      declinedMessage: text(200),
      cancelledMessage: text(200),
      errorMessage: text(200),
      showSupportEmail: z.boolean(),
    }),
    search: z.object({
      emptyMessage: text(200),
    }),
    notFound: z.object({
      heading: text(80),
      message: text(200),
    }),
    /** The slide-in cart opened from the header. */
    miniCart: z.object({
      heading: text(40),
      checkoutLabel: text(40),
      continueLabel: text(40),
      /** Small print under the total. Empty hides it. */
      totalNote: text(80).or(z.literal("")),
      showFreeShippingBar: z.boolean(),
      showTrustRow: z.boolean(),
      /** The row of reassurance items at the bottom (icon and a few words). */
      trustItems: z.array(z.object({ icon: z.enum(ICON_NAMES), text: text(40) })).max(4),
    }),
  })
  .strict();
export type DefaultPages = z.infer<typeof DefaultPagesSchema>;

export const DEFAULT_PAGES: DefaultPages = {
  checkout: { heading: "Checkout", showTrustBadges: true, note: "" },
  orderSuccess: {
    heading: "Thank you for your order!",
    message: "We have received your order and will send updates to {email}.",
    showCreateAccount: true,
    continueLabel: "Continue Shopping",
  },
  paymentFailed: {
    heading: "Payment unsuccessful",
    declinedMessage: "Your bank declined the payment. No money was taken.",
    cancelledMessage: "The payment was cancelled before it finished. No money was taken.",
    errorMessage: "Something went wrong while processing the payment. If any money was taken it is returned automatically.",
    showSupportEmail: true,
  },
  search: { emptyMessage: "No products found. Try different keywords, checking your spelling, or exploring our collections." },
  notFound: { heading: "We could not find that page", message: "It may have moved or no longer exist. Try a search, or head back to the shop." },
  miniCart: {
    heading: "Your Cart",
    checkoutLabel: "Proceed to Checkout",
    continueLabel: "Continue Shopping",
    totalNote: "Taxes and shipping calculated at checkout.",
    showFreeShippingBar: true,
    showTrustRow: true,
    trustItems: [
      { icon: "shield", text: "100% Secure Payments" },
      { icon: "returns", text: "Easy Returns" },
      { icon: "leaf", text: "Quality Assured" },
    ],
  },
};

export const DEFAULT_PAGE_LABELS: Record<keyof DefaultPages, string> = {
  checkout: "Checkout",
  orderSuccess: "Order success",
  paymentFailed: "Payment failed",
  search: "Search results",
  notFound: "Page not found (404)",
  miniCart: "Mini cart (slide-in cart)",
};

/**
 * What the storefront renders: the theme's copy merged over the built-in defaults, section by section.
 * Anything missing or invalid falls back to the default, so a bad stored value never breaks a page.
 */
export function resolveDefaultPages(raw: unknown): DefaultPages {
  const out: DefaultPages = structuredClone(DEFAULT_PAGES);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_PAGES) as Array<keyof DefaultPages>) {
    const section = src[key];
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;
    const merged = { ...DEFAULT_PAGES[key], ...(section as Record<string, unknown>) };
    const shape = DefaultPagesSchema.shape[key];
    const parsed = shape.safeParse(merged);
    if (parsed.success) (out[key] as unknown) = parsed.data;
  }
  return out;
}

/** Strict check used when staff save a theme draft: throws a readable message for the first problem. */
export function validateDefaultPages(raw: unknown): DefaultPages {
  const base: Record<string, unknown> = {};
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const key of Object.keys(DEFAULT_PAGES) as Array<keyof DefaultPages>) {
    const section = src[key];
    base[key] = { ...DEFAULT_PAGES[key], ...(section && typeof section === "object" && !Array.isArray(section) ? section : {}) };
  }
  const res = DefaultPagesSchema.safeParse({ ...base, ...Object.fromEntries(Object.keys(src).filter((k) => !(k in DEFAULT_PAGES)).map((k) => [k, src[k]])) });
  if (!res.success) {
    const issue = res.error.issues[0];
    throw new Error(`Default pages: ${issue?.path.join(".") ?? ""} ${issue?.message ?? "invalid"}`.trim());
  }
  return res.data;
}
