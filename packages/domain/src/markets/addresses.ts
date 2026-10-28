/**
 * Country-aware address checks (ADR-040). India keeps the exact rules checkout always had; the US and Canada get their own
 * postal-code and phone rules; any other country gets light, permissive checks. Pure, so forms and the server agree.
 */
export interface AddressCheck {
  country: string;
  state?: string | undefined;
  postalCode?: string | undefined;
  phone?: string | undefined;
}

const CA_POSTAL = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

export const POSTAL_LABEL: Readonly<Record<string, string>> = { IN: "pincode", US: "ZIP code", CA: "postal code" };

export function postalCodeProblem(country: string, postalCode: string | undefined): string | null {
  const code = (postalCode ?? "").trim();
  const c = country.toUpperCase();
  switch (c) {
    case "IN":
      return /^[1-9][0-9]{5}$/.test(code) ? null : "Valid 6-digit Indian pincode required";
    case "US":
      return /^\d{5}(-\d{4})?$/.test(code) ? null : "Valid US ZIP code required (12345 or 12345-6789)";
    case "CA":
      return CA_POSTAL.test(code) ? null : "Valid Canadian postal code required (for example M5V 2T6)";
    default:
      return /^[A-Za-z0-9][A-Za-z0-9 -]{1,10}$/.test(code) ? null : "A valid postal code is required";
  }
}

/** Digits only, without a leading country code for the NANP countries. */
export function normalizePhone(country: string, phone: string | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const c = country.toUpperCase();
  if ((c === "US" || c === "CA") && digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (c === "IN" && digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

export function phoneProblem(country: string, phone: string | undefined): string | null {
  const digits = normalizePhone(country, phone);
  switch (country.toUpperCase()) {
    case "IN":
      return /^[6-9][0-9]{9}$/.test(digits) ? null : "Valid 10-digit Indian phone number required";
    case "US":
    case "CA":
      return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? null : "Valid 10-digit phone number required";
    default:
      return digits.length >= 7 && digits.length <= 15 ? null : "A valid phone number is required";
  }
}

export function addressProblem(a: AddressCheck, opts: { phoneRequired?: boolean | undefined } = {}): string | null {
  const postal = postalCodeProblem(a.country, a.postalCode);
  if (postal) return postal;
  if (a.phone !== undefined && (opts.phoneRequired || a.phone.trim() !== "")) {
    const p = phoneProblem(a.country, a.phone);
    if (p) return p;
  }
  const c = a.country.toUpperCase();
  if ((c === "US" || c === "CA") && !/^[A-Za-z]{2}$/.test((a.state ?? "").trim())) {
    return c === "US" ? "Choose a US state" : "Choose a Canadian province";
  }
  return null;
}

export interface RegionOption {
  code: string;
  name: string;
}

export const US_STATES: readonly RegionOption[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"],
  ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"],
  ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
].map(([code, name]) => ({ code: code!, name: name! }));

export const CA_PROVINCES: readonly RegionOption[] = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"], ["NT", "Northwest Territories"], ["NS", "Nova Scotia"], ["NU", "Nunavut"],
  ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"],
].map(([code, name]) => ({ code: code!, name: name! }));

/** State or province choices for a country; empty means a free-text field. India keeps its existing state list elsewhere. */
export function regionsFor(country: string): readonly RegionOption[] {
  switch (country.toUpperCase()) {
    case "US":
      return US_STATES;
    case "CA":
      return CA_PROVINCES;
    default:
      return [];
  }
}
