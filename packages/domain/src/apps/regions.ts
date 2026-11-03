/**
 * Indian state codes (ADR-044). Geolocation sources disagree on codes: ISO 3166-2:IN changed several (Odisha OR -> OD,
 * Telangana TS -> TG, Uttarakhand UK -> UT, the Dadra/Daman merger), and Cloudflare and MaxMind return either form.
 * Everything stored and compared uses the current ISO code.
 */
export const IN_STATE_CODES = [
  "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DD", "DL", "GA", "GJ", "HR", "HP", "JK", "JH", "KA", "KL", "LA", "LD",
  "MP", "MH", "MN", "ML", "MZ", "NL", "OD", "PY", "PB", "RJ", "SK", "TN", "TG", "TR", "UP", "UT", "WB",
] as const;
export type InStateCode = (typeof IN_STATE_CODES)[number];

const STATE_SET: ReadonlySet<string> = new Set(IN_STATE_CODES);

const ALIASES: Readonly<Record<string, InStateCode>> = {
  DN: "DD",
  DH: "DD",
  OR: "OD",
  TS: "TG",
  UK: "UT",
  PO: "PY",
};

/** Normalises a region code from a geolocation source ("MH", "IN-MH", "mh") to the current ISO code, or null if it is not an Indian state. */
export function normalizeIndianState(raw: string | null | undefined): InStateCode | null {
  if (!raw) return null;
  let code = raw.trim().toUpperCase();
  if (code.startsWith("IN-")) code = code.slice(3);
  if (STATE_SET.has(code)) return code as InStateCode;
  return ALIASES[code] ?? null;
}

export function isIndianStateCode(code: string): code is InStateCode {
  return STATE_SET.has(code);
}
