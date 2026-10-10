/**
 * Mask a phone number to reveal only the last 4 digits.
 * Invariant: Full phone numbers, OTPs, and message bodies are NEVER logged or returned.
 * Example: "+919876543210" -> "********3210"
 */
export function maskPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "******";
  if (digits.length <= 4) {
    return `****${digits}`;
  }
  const maskedCount = Math.max(4, digits.length - 4);
  return `${"*".repeat(maskedCount)}${digits.slice(-4)}`;
}

/**
 * Normalise a phone number to clean E.164 digits without punctuation.
 */
export function cleanPhoneNumber(phone: string): string {
  return phone.replace(/[^\d+]/g, "").trim();
}
