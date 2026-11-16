/**
 * A customer who signs in with a phone number only has no email. The row still needs one, so it gets a placeholder address.
 * The placeholder must never be a real mailbox: `.invalid` is reserved by RFC 2606 and can never be registered, so a mail
 * sent to it cannot reach anyone (audit A2-06). Rows created before this change use `@customer.store`, which is a real
 * domain; both are recognised as "no email" and neither is ever mailed.
 */
export const PHONE_PLACEHOLDER_DOMAIN = "phone.invalid";
const LEGACY_PLACEHOLDER_DOMAIN = "customer.store";

export function placeholderEmailForPhone(phoneDigits: string): string {
  return `${phoneDigits}@${PHONE_PLACEHOLDER_DOMAIN}`;
}

export function isPlaceholderCustomerEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return e.endsWith(`@${PHONE_PLACEHOLDER_DOMAIN}`) || e.endsWith(`@${LEGACY_PLACEHOLDER_DOMAIN}`);
}
