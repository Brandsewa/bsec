/**
 * GSTIN Validation & State Code Helpers (PLAN §15 / Settings Rebuild Phase 6 / Slice 6B).
 *
 * Rules:
 * 1. 15 characters matching ^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$
 * 2. Official 2-digit state/UT code (01 - 38, excluding 28, plus other standard mappings).
 * 3. Mod-36 weighted checksum verification.
 */

export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Calculates the expected 15th check character of a 14-character GSTIN prefix using Mod-36.
 */
export function calculateGstinChecksum(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const char = first14[i];
    if (!char) return "";
    const val = CHARS.indexOf(char);
    if (val === -1) return "";

    // Weights alternate: 1 for odd positions (0-indexed: 0, 2, 4...), 2 for even (1, 3, 5...)
    const weight = i % 2 === 0 ? 1 : 2;
    const product = val * weight;
    const quotient = Math.floor(product / 36);
    const remainder = product % 36;
    sum += quotient + remainder;
  }
  const checkCode = (36 - (sum % 36)) % 36;
  return CHARS.charAt(checkCode);
}

export interface GstinValidationResult {
  valid: boolean;
  stateCode?: string;
  stateName?: string;
  error?: string;
}

/**
 * Pure validator for an Indian 15-character GSTIN.
 * Optionally verifies whether the derived state matches expectedState.
 */
export function validateGstin(
  gstin: string | null | undefined,
  expectedState?: string | null,
): GstinValidationResult {
  if (!gstin) {
    return { valid: false, error: "GSTIN is required" };
  }

  const trimmed = gstin.trim();
  if (trimmed.length !== 15) {
    return { valid: false, error: "GSTIN must be exactly 15 characters" };
  }

  if (trimmed !== trimmed.toUpperCase()) {
    return { valid: false, error: "GSTIN must be uppercase" };
  }

  if (!GSTIN_REGEX.test(trimmed)) {
    return { valid: false, error: "Invalid GSTIN format" };
  }

  const stateCode = trimmed.slice(0, 2);
  const stateName = GST_STATE_CODES[stateCode];
  if (!stateName) {
    return { valid: false, stateCode, error: `Invalid GST state code: ${stateCode}` };
  }

  const expectedCheckChar = calculateGstinChecksum(trimmed.slice(0, 14));
  if (trimmed[14] !== expectedCheckChar) {
    return {
      valid: false,
      stateCode,
      stateName,
      error: `Invalid GSTIN checksum character (expected ${expectedCheckChar}, got ${trimmed[14]})`,
    };
  }

  if (expectedState && expectedState.trim()) {
    const normExpected = expectedState.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const normActual = stateName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normExpected !== normActual) {
      return {
        valid: false,
        stateCode,
        stateName,
        error: `GSTIN state code ${stateCode} (${stateName}) does not match registered seller state '${expectedState}'`,
      };
    }
  }

  return {
    valid: true,
    stateCode,
    stateName,
  };
}
