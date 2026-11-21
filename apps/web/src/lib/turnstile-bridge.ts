import { hostnameOf } from "../server/hosts.ts";

/**
 * The Turnstile widget only works on the hostnames listed for it in Cloudflare (10 at most), but stores can have any
 * custom domain. So every store shows the widget inside a small frame served from the platform's own host (the one
 * hostname on the list, the one the signup page already uses), and the frame hands the token back with postMessage.
 * Using it for every store means nothing depends on how Cloudflare treats subdomains. Pure helpers shared by the
 * checkout page, the frame and the form (audit A3-04).
 */
export const BRIDGE_MESSAGE_TYPE = "bs-turnstile";
export const BRIDGE_FRAME_PATH = "/challenge-frame";

export type BridgeMessage =
  | { kind: "token"; token: string }
  | { kind: "expired" }
  | { kind: "failed" }
  | { kind: "height"; height: number };

/** An http(s) origin ("https://shop.example.com", no path), or null. */
export function toOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Where the checkout of `host` gets its challenge from: "bridge" with the origin that serves the frame (every store),
 * or "direct" (the widget on the page itself) for local development only.
 */
export function checkoutChallengeMode(
  host: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): { mode: "direct" } | { mode: "bridge"; origin: string } {
  const hostname = hostnameOf(host);
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost")) return { mode: "direct" };
  const platformDomain = (env.PLATFORM_DOMAIN || "bcom.si").toLowerCase();
  const origin = toOrigin(env.CHECKOUT_CHALLENGE_ORIGIN) ?? `https://${platformDomain}`;
  return { mode: "bridge", origin };
}

/**
 * Reads a message the frame posted to the checkout page. Accepts it only when it came from the frame element itself AND
 * from the expected origin, and shapes it; anything else is ignored.
 */
export function parseBridgeMessage(data: unknown, eventOrigin: string, expectedOrigin: string, fromFrame: boolean): BridgeMessage | null {
  if (!fromFrame || eventOrigin !== expectedOrigin) return null;
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.type !== BRIDGE_MESSAGE_TYPE) return null;
  switch (m.kind) {
    case "token":
      return typeof m.token === "string" && m.token.length > 0 && m.token.length <= 4096 ? { kind: "token", token: m.token } : null;
    case "expired":
      return { kind: "expired" };
    case "failed":
      return { kind: "failed" };
    case "height":
      return typeof m.height === "number" && Number.isFinite(m.height) ? { kind: "height", height: Math.min(400, Math.max(0, Math.round(m.height))) } : null;
    default:
      return null;
  }
}
