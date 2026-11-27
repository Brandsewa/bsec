import type { PolicyHandle } from "./admin.ts";

/** Canonical policy handles supported by storefront `/policies/[type]` pages. */
export const STORE_POLICY_HANDLES = ["privacy", "terms", "refund", "shipping", "legal_notice"] as const satisfies readonly PolicyHandle[];

const HANDLE_SET: ReadonlySet<string> = new Set(STORE_POLICY_HANDLES);

/** Ordered options shown in navigation menu editors when linking to a store policy. */
export const STORE_POLICY_LINK_OPTIONS: ReadonlyArray<{ handle: PolicyHandle; label: string; path: string }> = [
  { handle: "privacy", label: "Privacy Policy", path: "/policies/privacy" },
  { handle: "terms", label: "Terms of Service", path: "/policies/terms" },
  { handle: "refund", label: "Refund & Cancellation Policy", path: "/policies/refund" },
  { handle: "shipping", label: "Shipping Policy", path: "/policies/shipping" },
  { handle: "legal_notice", label: "Legal Notice", path: "/policies/legal_notice" },
];

/** Type guard for canonical store policy handles. */
export function isStorePolicyHandle(value: string | undefined | null): value is PolicyHandle {
  return typeof value === "string" && HANDLE_SET.has(value);
}

/** Extracts a policy handle from a URL like `/policies/privacy` (ignoring query, hash, or trailing slash). */
export function extractPolicyHandleFromUrl(url: string | undefined | null): PolicyHandle | undefined {
  if (!url) return undefined;
  const clean = url.trim().toLowerCase().split(/[?#]/)[0]?.replace(/\/+$/, "") ?? "";
  const match = /^\/?policies\/([^/]+)$/.exec(clean);
  const candidate = match?.[1];
  return isStorePolicyHandle(candidate) ? candidate : undefined;
}

/**
 * Infers a store policy handle from a menu item's display label when older menu items
 * were saved with a bare `/policies` URL and no `targetId`.
 */
export function inferPolicyHandleFromLabel(label: string | undefined | null): PolicyHandle | undefined {
  if (!label) return undefined;
  const text = label.trim().toLowerCase();
  if (!text) return undefined;
  if (/\bprivacy\b/.test(text)) return "privacy";
  if (/\b(terms|conditions)\b/.test(text)) return "terms";
  if (/\b(refunds?|returns?|cancellations?|cancel)\b/.test(text)) return "refund";
  if (/\b(shipping|delivery)\b/.test(text)) return "shipping";
  if (/\blegal(\s+notice)?\b/.test(text)) return "legal_notice";
  return undefined;
}

const SAFE_POLICY_LINK = /^(\/(?!\/)|#|https:\/\/|mailto:|tel:)/i;

/**
 * Resolves the storefront href for a `policy` menu item from its target handle, stored URL,
 * or label fallback (repairs legacy menu items saved with `/policies` and no target).
 */
export function resolvePolicyMenuHref(input: {
  targetId?: string | undefined;
  url?: string | undefined;
  label?: string | undefined;
}): string {
  if (isStorePolicyHandle(input.targetId)) {
    return `/policies/${input.targetId}`;
  }
  const fromUrl = extractPolicyHandleFromUrl(input.url);
  if (fromUrl) {
    return `/policies/${fromUrl}`;
  }
  const raw = (input.url ?? "").trim();
  if (!raw || /^\/policies\/?$/i.test(raw)) {
    const inferred = inferPolicyHandleFromLabel(input.label);
    return inferred ? `/policies/${inferred}` : "/policies";
  }
  return SAFE_POLICY_LINK.test(raw) ? raw : "/policies";
}
