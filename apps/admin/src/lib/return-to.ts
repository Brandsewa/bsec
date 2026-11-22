/**
 * Where to go after sign-in. Only a path inside this app is accepted ("/something", never "//host", a scheme or a backslash),
 * so a crafted link can never send a signed-in user to another site (open redirect). Used by the AI app authorize flow.
 */
export function safeReturnTo(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  if (raw.length > 300 || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return undefined;
  for (const ch of raw) if (ch.charCodeAt(0) < 32) return undefined; // no control characters
  return raw;
}
