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

export const IN_STATE_NAMES: Readonly<Record<InStateCode, string>> = {
  AN: "Andaman and Nicobar Islands", AP: "Andhra Pradesh", AR: "Arunachal Pradesh", AS: "Assam", BR: "Bihar", CH: "Chandigarh",
  CG: "Chhattisgarh", DD: "Dadra and Nagar Haveli and Daman and Diu", DL: "Delhi", GA: "Goa", GJ: "Gujarat", HR: "Haryana",
  HP: "Himachal Pradesh", JK: "Jammu and Kashmir", JH: "Jharkhand", KA: "Karnataka", KL: "Kerala", LA: "Ladakh", LD: "Lakshadweep",
  MP: "Madhya Pradesh", MH: "Maharashtra", MN: "Manipur", ML: "Meghalaya", MZ: "Mizoram", NL: "Nagaland", OD: "Odisha",
  PY: "Puducherry", PB: "Punjab", RJ: "Rajasthan", SK: "Sikkim", TN: "Tamil Nadu", TG: "Telangana", TR: "Tripura",
  UP: "Uttar Pradesh", UT: "Uttarakhand", WB: "West Bengal",
};

// Some datasets write "The Dadra And Nagar Haveli And Daman And Diu"; the leading article is not part of the name.
const squash = (name: string) => name.toUpperCase().replace(/&/g, "AND").replace(/[^A-Z]/g, "").replace(/^THE(?=DADRA)/, "");

const NAME_TO_CODE = new Map<string, InStateCode>([
  ...(Object.entries(IN_STATE_NAMES) as [InStateCode, string][]).map(([code, name]) => [squash(name), code] as [string, InStateCode]),
  // Names India Post and older datasets use.
  [squash("Orissa"), "OD"],
  [squash("Pondicherry"), "PY"],
  [squash("Uttaranchal"), "UT"],
  [squash("NCT of Delhi"), "DL"],
  [squash("Dadra and Nagar Haveli"), "DD"],
  [squash("Daman and Diu"), "DD"],
]);

/** "TAMIL NADU", "Jammu & Kashmir", "Orissa" -> the ISO code, or null when the name is not recognised. */
export function stateCodeForName(name: string | null | undefined): InStateCode | null {
  if (!name) return null;
  return NAME_TO_CODE.get(squash(name)) ?? null;
}
