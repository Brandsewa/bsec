import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { checkRateLimit, RateLimitExceededError } from "../system/rate-limit.ts";
import { sanitizePlainText } from "../review-services.ts";

export interface SubmitContactFormInput {
  formName?: string | undefined;
  name: string;
  email: string;
  phone?: string | undefined;
  choice?: string | undefined;
  message?: string | undefined;
  /** Where the form was set up to send submissions (the Contact form block's setting); empty = the store's admin email. */
  recipientEmail?: string | undefined;
  /** A hidden field real visitors leave empty; bots fill it. */
  honeypot?: string | undefined;
  ip?: string | undefined;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Stores a storefront contact-form submission in the admin inbox. Public input: plain text only, links stripped, honeypot and a
 * per-connection rate limit. Email delivery is not live yet, so the inbox is where the owner reads them; the recipient is kept on the row.
 */
export async function submitContactForm(rt: Runtime, tenantId: string, input: SubmitContactFormInput): Promise<{ success: true }> {
  if (input.honeypot && input.honeypot.trim() !== "") return { success: true }; // silently drop bots
  const db = rt._db.db;
  if (input.ip && input.ip !== "unknown") {
    const key = `contact_form:ip:${tenantId}:${input.ip}`;
    const res = await checkRateLimit(db, { key, limit: 8, windowSeconds: 3600 });
    if (!res.allowed) throw new RateLimitExceededError("Too many messages from this connection. Please try again later.", res.retryAfter, 8, key);
  }
  const name = sanitizePlainText(input.name).slice(0, 120);
  const email = input.email.trim().toLowerCase();
  if (!name) throw new Error("Bad Request: Please enter your name.");
  if (!EMAIL.test(email) || email.length > 254) throw new Error("Bad Request: Please enter a valid email address.");
  const recipient = input.recipientEmail?.trim().toLowerCase();
  const phone = input.phone ? input.phone.replace(/[^0-9+ ]/g, "").slice(0, 20) : null;

  await withTenant(db, tenantId, async (tx) => {
    await tx.insert(schema.formSubmissions).values({
      tenantId,
      formName: sanitizePlainText(input.formName ?? "Contact form").slice(0, 80) || "Contact form",
      name,
      email,
      phone: phone || null,
      choice: input.choice ? sanitizePlainText(input.choice).slice(0, 120) : null,
      message: input.message ? sanitizePlainText(input.message).slice(0, 4000) : null,
      recipientEmail: recipient && EMAIL.test(recipient) ? recipient : null,
    });
  });
  return { success: true };
}
