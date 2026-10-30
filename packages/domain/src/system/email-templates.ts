/**
 * Transactional email content (HTML + plain text). Pure: no database, no network. The sender loads the store and the
 * order and hands them in, so these functions are easy to test and can never leak another store's data.
 * All amounts are paise; every piece of shopper- or merchant-provided text is HTML-escaped.
 */

import { formatMoney } from "@bs/contracts/money";
import { DEFAULT_EMAIL_BRANDING, FONT_STACKS, type EmailBrandingTokens } from "./email-branding.ts";

export interface EmailBrand {
  storeName: string;
  /** The store's public address, e.g. https://tasteofhills.bcom.si (no trailing slash). */
  baseUrl: string;
  supportEmail?: string | null | undefined;
  /** Optional custom footer note from store notification settings (0..300 chars, escaped). */
  footerNote?: string | null | undefined;
  /** Optional unsubscribe URL for marketing emails. */
  unsubscribeUrl?: string | null | undefined;
  /** Colours, logo, fonts and footer (email-branding.ts). Missing means the BCom defaults. */
  branding?: EmailBrandingTokens | undefined;
}

export interface EmailOrderLine {
  title: string;
  variant?: string | null | undefined;
  quantity: number;
  total: number;
}

export interface EmailOrder {
  number: string;
  placedAt?: string | undefined;
  items: EmailOrderLine[];
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  codFee: number;
  grandTotal: number;
  /** ISO currency the order was charged in; INR when absent (ADR-040). */
  currency?: string | undefined;
  paymentStatus: string;
  shippingAddress?: {
    fullName?: string | undefined;
    addressLine1?: string | undefined;
    addressLine2?: string | undefined;
    city?: string | undefined;
    state?: string | undefined;
    pincode?: string | undefined;
  } | null | undefined;
  /** A link that shows this order without a login (an order-view token). */
  orderUrl?: string | undefined;
  /** Market policy text snapshotted on the order at purchase (ADR-040). */
  policyText?: string | null | undefined;
}

export interface EmailData {
  order?: EmailOrder | undefined;
  awb?: string | undefined;
  carrier?: string | undefined;
  returnNumber?: string | undefined;
  /** Carrier link for this parcel (http or https only). */
  trackingUrl?: string | undefined;
  /** What is in this parcel, and which parcel of how many (split orders send one email per parcel). */
  parcelItems?: Array<{ title: string; variant?: string | null | undefined; quantity: number }> | undefined;
  parcelNumber?: number | undefined;
  parcelCount?: number | undefined;
  /** "Estimated delivery" text, only when the store sets a delivery window. */
  estimatedDelivery?: string | undefined;
  refundAmount?: number | undefined;
  /** Link back to the cart, for the abandoned-cart reminder. */
  cartUrl?: string | undefined;
  [key: string]: unknown;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Formats minor units in the order's currency (INR by default, which keeps the old rupee output). */
export function formatInr(paise: number, currency = "INR"): string {
  return formatMoney(Number.isFinite(paise) ? paise : 0, currency);
}

function paymentLine(status: string): string {
  switch (status) {
    case "cod_pending":
      return "Cash on delivery: please pay when your order arrives.";
    case "paid":
    case "captured":
      return "Paid. Thank you!";
    case "refunded":
      return "Refunded.";
    case "cancelled":
      return "No payment is due.";
    default:
      return "Payment is awaiting confirmation.";
  }
}

function addressLines(a: EmailOrder["shippingAddress"]): string[] {
  if (!a) return [];
  return [a.fullName, a.addressLine1, a.addressLine2, [a.city, a.state].filter(Boolean).join(", "), a.pincode].filter((l): l is string => Boolean(l && l.trim()));
}

// --- layout ---------------------------------------------------------------------------------------------------------
// Modern, responsive, table-based markup that survives Gmail, Outlook and Apple Mail. Every colour, font and size comes
// from the branding tokens (email-branding.ts): the helpers below emit %%token%% placeholders and layout() fills them in,
// so each template stays free of styling decisions.

function mix(a: string, b: string, weight: number): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - weight) + ((pb >> shift) & 255) * weight);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

function applyTokens(html: string, t: EmailBrandingTokens): string {
  const values: Record<string, string> = {
    accent: t.accent,
    btnBg: t.buttonBackground,
    btnText: t.buttonText,
    link: t.linkColor,
    text: t.text,
    muted: t.mutedText,
    border: mix(t.card, t.text, 0.12),
    soft: mix(t.card, t.text, 0.04),
    font: FONT_STACKS[t.fontFamily],
    fs: `${t.baseFontSize}px`,
    fsSmall: `${Math.max(11, t.baseFontSize - 2)}px`,
    h1: `${Math.round(t.baseFontSize * t.headingScale)}px`,
  };
  return html.replace(/%%(\w+)%%/g, (m, key: string) => values[key] ?? m);
}

function layout(brand: EmailBrand, title: string, bodyHtml: string, preheader = ""): string {
  const t = brand.branding ?? DEFAULT_EMAIL_BRANDING;
  const f = t.footer;
  const supportAddress = brand.supportEmail || f.supportEmail;
  const support = supportAddress ? `<p style="margin:10px 0 0">Questions? Reply to this email or write to <a href="mailto:${escapeHtml(supportAddress)}" style="color:%%link%%;text-decoration:underline">${escapeHtml(supportAddress)}</a>.</p>` : "";
  const footerNote = brand.footerNote ? `<p style="margin:10px 0 0">${escapeHtml(brand.footerNote)}</p>` : "";
  const footerText = f.text ? `<p style="margin:10px 0 0">${escapeHtml(f.text)}</p>` : "";
  const address = f.address ? `<p style="margin:10px 0 0">${escapeHtml(f.address)}</p>` : "";
  const links = f.links.length
    ? `<p style="margin:12px 0 0">${f.links.map((l) => `<a href="${escapeHtml(l.url)}" style="color:%%link%%;text-decoration:underline">${escapeHtml(l.label)}</a>`).join(" &nbsp;·&nbsp; ")}</p>`
    : "";
  const unsub = brand.unsubscribeUrl ? `<p style="margin:12px 0 0"><a href="${escapeHtml(brand.unsubscribeUrl)}" style="color:%%muted%%;text-decoration:underline">Unsubscribe from marketing emails</a></p>` : "";
  const logo = t.logoUrl
    ? `<a href="${escapeHtml(brand.baseUrl)}" style="text-decoration:none"><img src="${escapeHtml(t.logoUrl)}" alt="${escapeHtml(brand.storeName)}" height="44" style="display:block;border:0;outline:none;height:44px;max-height:44px;width:auto;max-width:220px"></a>`
    : `<a href="${escapeHtml(brand.baseUrl)}" style="font-size:20px;line-height:1.2;font-weight:700;color:${t.headerText};text-decoration:none">${escapeHtml(brand.storeName)}</a>`;
  const hidden = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${t.background}">${escapeHtml(preheader)}${"&zwnj;&nbsp;".repeat(40)}</div>`
    : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(title)}</title>
<style>
@media only screen and (max-width:620px){
.bs-wrap{padding:12px 8px !important}
.bs-card{border-radius:12px !important}
.bs-pad{padding-left:20px !important;padding-right:20px !important}
.bs-btn-wrap{width:100% !important}
.bs-btn,.bs-btn a{display:block !important;width:100% !important;box-sizing:border-box;text-align:center !important}
.bs-h1{font-size:22px !important}
}
</style></head>
<body style="margin:0;padding:0;background:${t.background};font-family:%%font%%;color:%%text%%;-webkit-text-size-adjust:100%">${hidden}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.background}"><tr><td class="bs-wrap" align="center" style="padding:28px 12px">
<table role="presentation" class="bs-card" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${t.card};border-radius:16px;overflow:hidden;border:1px solid %%border%%">
<tr><td style="height:4px;line-height:4px;font-size:4px;background:%%accent%%">&nbsp;</td></tr>
<tr><td class="bs-pad" style="padding:22px 32px;background:${t.headerBackground};border-bottom:1px solid %%border%%">${logo}</td></tr>
<tr><td class="bs-pad" style="padding:32px;font-size:%%fs%%;line-height:1.6">${bodyHtml}</td></tr>
<tr><td class="bs-pad" style="padding:22px 32px;background:%%soft%%;border-top:1px solid %%border%%;font-size:%%fsSmall%%;line-height:1.55;color:%%muted%%">
<p style="margin:0;font-weight:600;color:%%text%%">${escapeHtml(brand.storeName)}</p><p style="margin:2px 0 0"><a href="${escapeHtml(brand.baseUrl)}" style="color:%%muted%%;text-decoration:underline">${escapeHtml(brand.baseUrl.replace(/^https?:\/\//, ""))}</a></p>${address}${footerText}${support}${links}${footerNote}${unsub}
</td></tr></table></td></tr></table></body></html>`;
  return applyTokens(html, t);
}

function button(label: string, href: string): string {
  // A padded table cell is the one button shape every mail client renders, including Outlook.
  return `<table role="presentation" class="bs-btn-wrap" cellpadding="0" cellspacing="0" style="margin:26px 0 4px"><tr><td class="bs-btn" style="border-radius:10px;background:%%btnBg%%"><a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;font-size:%%fs%%;font-weight:600;line-height:1.2;color:%%btnText%%;text-decoration:none;border-radius:10px">${escapeHtml(label)}</a></td></tr></table>`;
}

function heading(text: string): string {
  return `<h1 class="bs-h1" style="margin:0 0 14px;font-size:%%h1%%;line-height:1.25;font-weight:700;color:%%text%%">${escapeHtml(text)}</h1>`;
}

function para(text: string): string {
  return `<p style="margin:0 0 14px;font-size:%%fs%%;line-height:1.6;color:%%text%%">${escapeHtml(text)}</p>`;
}

function orderBlock(o: EmailOrder): { html: string; text: string } {
  const rows = o.items
    .map(
      (it) =>
        `<tr><td style="padding:12px 0;font-size:%%fs%%;border-bottom:1px solid %%border%%">${escapeHtml(it.title)}${it.variant && it.variant !== "Default" ? ` <span style="color:%%muted%%">(${escapeHtml(it.variant)})</span>` : ""} <span style="color:%%muted%%">× ${it.quantity}</span></td><td align="right" style="padding:12px 0 12px 12px;font-size:%%fs%%;border-bottom:1px solid %%border%%;white-space:nowrap">${formatInr(it.total, o.currency)}</td></tr>`,
    )
    .join("");
  const line = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:5px 0;font-size:%%fs%%;${bold ? "font-weight:700;" : "color:%%muted%%;"}">${escapeHtml(label)}</td><td align="right" style="padding:5px 0;font-size:%%fs%%;${bold ? "font-weight:700;" : ""}">${value}</td></tr>`;
  const totals = [
    line("Subtotal", formatInr(o.subtotal, o.currency)),
    o.discountTotal > 0 ? line("Discount", `−${formatInr(o.discountTotal, o.currency)}`) : "",
    line("Shipping", o.shippingTotal === 0 ? "Free" : formatInr(o.shippingTotal, o.currency)),
    o.codFee > 0 ? line("Cash on delivery fee", formatInr(o.codFee, o.currency)) : "",
    line("Total", formatInr(o.grandTotal, o.currency), true),
  ].join("");
  const addr = addressLines(o.shippingAddress);
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;background:%%soft%%;border-radius:12px"><tr><td style="padding:16px 18px">
<p style="margin:0 0 6px;font-size:%%fsSmall%%;color:%%muted%%;text-transform:uppercase;letter-spacing:.06em">Order <strong style="color:%%text%%">${escapeHtml(o.number)}</strong></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${totals}</table>
<p style="margin:12px 0 0;font-size:%%fs%%">${escapeHtml(paymentLine(o.paymentStatus))}</p>
</td></tr></table>
${addr.length ? `<p style="margin:16px 0 0;font-size:%%fsSmall%%;color:%%muted%%;line-height:1.55"><strong style="color:%%text%%">Delivering to</strong><br>${addr.map(escapeHtml).join("<br>")}</p>` : ""}`;
  const text = [
    `Order ${o.number}`,
    ...o.items.map((it) => `- ${it.title}${it.variant && it.variant !== "Default" ? ` (${it.variant})` : ""} x ${it.quantity}: ${formatInr(it.total, o.currency)}`),
    `Subtotal: ${formatInr(o.subtotal, o.currency)}`,
    ...(o.discountTotal > 0 ? [`Discount: -${formatInr(o.discountTotal, o.currency)}`] : []),
    `Shipping: ${o.shippingTotal === 0 ? "Free" : formatInr(o.shippingTotal, o.currency)}`,
    ...(o.codFee > 0 ? [`Cash on delivery fee: ${formatInr(o.codFee, o.currency)}`] : []),
    `Total: ${formatInr(o.grandTotal, o.currency)}`,
    paymentLine(o.paymentStatus),
    ...(addr.length ? ["", "Delivering to:", ...addr] : []),
  ].join("\n");
  return { html, text };
}

function footerText(brand: EmailBrand): string {
  const f = (brand.branding ?? DEFAULT_EMAIL_BRANDING).footer;
  const parts = [`\n\n${brand.storeName}`, brand.baseUrl];
  if (f.address) parts.push(f.address);
  if (f.text) parts.push(f.text);
  const supportAddress = brand.supportEmail || f.supportEmail;
  if (supportAddress) parts.push(`Questions? ${supportAddress}`);
  for (const l of f.links) parts.push(`${l.label}: ${l.url}`);
  if (brand.footerNote) parts.push(brand.footerNote);
  if (brand.unsubscribeUrl) parts.push(`Unsubscribe: ${brand.unsubscribeUrl}`);
  return `${parts.join("\n")}\n`;
}

// --- templates ------------------------------------------------------------------------------------------------------

type Builder = (brand: EmailBrand, data: EmailData, subject: string) => RenderedEmail;

function orderEmail(opts: {
  title: string;
  intro: (d: EmailData) => string;
  extra?: (d: EmailData) => string;
  /** Rich block after the extra line, as html and plain text. */
  after?: (d: EmailData) => { html: string; text: string } | null;
  cta?: string;
}): Builder {
  return (brand, data, subject) => {
    const o = data.order;
    const intro = opts.intro(data);
    const extra = opts.extra?.(data) ?? "";
    const block = o ? orderBlock(o) : null;
    const policyHtml = o?.policyText ? `<div style="margin:20px 0 0;padding:12px 14px;background:%%soft%%;border-radius:8px;font-size:%%fsSmall%%;color:%%muted%%;line-height:1.5"><strong style="color:%%text%%">Store policy:</strong><br>${escapeHtml(o.policyText)}</div>` : "";
    const policyTextStr = o?.policyText ? `\n\nPolicy:\n${o.policyText}` : "";
    const after = opts.after?.(data) ?? null;
    const html = layout(
      brand,
      subject,
      `${heading(opts.title)}${para(intro)}${extra ? para(extra) : ""}${after ? after.html : ""}${block ? block.html : ""}${policyHtml}${o?.orderUrl ? button(opts.cta ?? "View your order", o.orderUrl) : ""}`,
    );
    const text = `${opts.title}\n\n${intro}${extra ? `\n${extra}` : ""}${after ? `\n\n${after.text}` : ""}${block ? `\n\n${block.text}` : ""}${policyTextStr}${o?.orderUrl ? `\n\n${opts.cta ?? "View your order"}: ${o.orderUrl}` : ""}${footerText(brand)}`;
    return { html, text };
  };
}

/** The parcel in a shipped email: what is inside (for split orders) and the carrier's own tracking link. */
function shippedParcelBlock(d: EmailData): { html: string; text: string } | null {
  const items = d.parcelItems ?? [];
  const link = d.trackingUrl && /^https?:\/\/\S+$/i.test(d.trackingUrl) ? d.trackingUrl : null;
  if (items.length === 0 && !link) return null;
  const split = (d.parcelCount ?? 1) > 1;
  const head = split ? `In this parcel (${d.parcelNumber ?? 1} of ${d.parcelCount})` : "In this parcel";
  const line = (it: { title: string; variant?: string | null | undefined; quantity: number }) =>
    `${it.title}${it.variant && it.variant !== "Default" ? ` (${it.variant})` : ""} x ${it.quantity}`;
  const html =
    (items.length > 0
      ? `<p style="margin:0 0 6px;font-size:%%fsSmall%%;color:%%muted%%;text-transform:uppercase;letter-spacing:.06em">${escapeHtml(head)}</p><ul style="margin:0 0 14px;padding-left:18px;font-size:%%fs%%;line-height:1.6;color:%%text%%">${items.map((it) => `<li>${escapeHtml(line(it))}</li>`).join("")}</ul>`
      : "") +
    (link ? `<p style="margin:0 0 14px;font-size:%%fs%%;line-height:1.6"><a href="${escapeHtml(link)}" style="color:%%text%%;text-decoration:underline">Track with ${escapeHtml(d.carrier ?? "the carrier")}</a></p>` : "");
  const text = [items.length > 0 ? `${head}:\n${items.map((it) => `- ${line(it)}`).join("\n")}` : "", link ? `Track with ${d.carrier ?? "the carrier"}: ${link}` : ""].filter(Boolean).join("\n\n");
  return { html, text };
}

const TEMPLATES: Record<string, Builder> = {
  order_confirmation: orderEmail({
    title: "Thank you for your order!",
    intro: (d) => `We have received your order${d.order ? ` ${d.order.number}` : ""} and will let you know when it ships.`,
  }),
  order_shipped: orderEmail({
    title: "Your order is on its way",
    intro: (d) => `Good news: order${d.order ? ` ${d.order.number}` : ""} has shipped.`,
    extra: (d) =>
      [
        d.carrier ? `Carrier: ${d.carrier}.` : "",
        d.awb ? `Tracking number: ${d.awb}.` : "",
        d.estimatedDelivery ? `Estimated delivery: ${d.estimatedDelivery}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    after: shippedParcelBlock,
    cta: "Track your order",
  }),
  order_delivered: orderEmail({
    title: "Your order was delivered",
    intro: (d) => `Order${d.order ? ` ${d.order.number}` : ""} has been delivered. We hope you enjoy it!`,
  }),
  order_rto: orderEmail({
    title: "We couldn't deliver your order",
    intro: (d) =>
      `The courier couldn't deliver order${d.order ? ` ${d.order.number}` : ""} and it is being returned to us. Please contact the store if you would like us to send it again.`,
  }),
  return_requested: orderEmail({
    title: "We received your return request",
    intro: (d) => `Your return request${d.returnNumber ? ` ${d.returnNumber}` : ""} is with us. We will review it and get back to you soon.`,
  }),
  refund_processed: orderEmail({
    title: "Your refund is on its way",
    intro: (d) =>
      `We have processed a refund${typeof d.refundAmount === "number" && d.refundAmount > 0 ? ` of ${formatInr(d.refundAmount, d.order?.currency)}` : ""}${d.order ? ` for order ${d.order.number}` : ""}. It can take a few days to show in your account.`,
  }),
  order_preorder_date_changed: orderEmail({
    title: "Update on your pre-order ship date",
    intro: (d) =>
      `The dispatch date for order${d.order ? ` ${d.order.number}` : ""} has changed. It is now expected to ship on or after ${String(d.shipsOn ?? "")}.${d.reason ? ` Reason: ${String(d.reason)}.` : ""}`,
  }),
  order_preorder_reminder: orderEmail({
    title: "Your pre-order ships soon",
    intro: (d) =>
      `Your pre-order${d.order ? ` ${d.order.number}` : ""} is scheduled to ship soon (expected on or after ${String(d.shipsOn ?? "")}). We will send tracking details as soon as it is dispatched.`,
  }),
  abandoned_cart_recovery: (brand, data, subject) => {
    const cta = data.cartUrl ?? `${brand.baseUrl}/cart`;
    const html = layout(brand, subject, `${heading("Did you leave something behind?")}${para("You added items to your cart but didn't finish checking out. They are still waiting for you.")}${button("Return to your cart", cta)}`);
    const text = `Did you leave something behind?\n\nYou added items to your cart but didn't finish checking out. They are still waiting for you.\n\nReturn to your cart: ${cta}${footerText(brand)}`;
    return { html, text };
  },
  password_reset: (brand, data, subject) => {
    const resetUrl = String(data.resetUrl ?? data.url ?? "");
    const html = layout(
      brand,
      subject,
      `${heading("Reset your password")}${para("We received a request to reset your password. This link will expire in 1 hour.")}${button("Reset password", resetUrl)}${para("If you didn't ask to reset your password, you can safely ignore this email.")}`,
    );
    const text = `Reset your password\n\nWe received a request to reset your password. This link will expire in 1 hour.\n\nReset password: ${resetUrl}\n\nIf you didn't ask to reset your password, you can safely ignore this email.${footerText(brand)}`;
    return { html, text };
  },
  password_changed: (brand, _data, subject) => {
    const html = layout(
      brand,
      subject,
      `${heading("Your password was changed")}${para("Your password has been changed successfully. All other active sessions have been signed out.")}${para("If you did not make this change, please reset your password immediately or contact support.")}`,
    );
    const text = `Your password was changed\n\nYour password has been changed successfully. All other active sessions have been signed out.\n\nIf you did not make this change, please reset your password immediately or contact support.${footerText(brand)}`;
    return { html, text };
  },
  customer_welcome: (brand, data, subject) => {
    const verifyUrl = String(data.verifyUrl ?? "");
    const html = layout(
      brand,
      subject,
      `${heading(`Welcome to ${escapeHtml(brand.storeName)}!`)}${para("Thank you for creating an account with us. Please verify your email address to confirm your account.")}${verifyUrl ? button("Verify email", verifyUrl) : ""}`,
    );
    const text = `Welcome to ${brand.storeName}!\n\nThank you for creating an account with us. Please verify your email address to confirm your account.${verifyUrl ? `\n\nVerify email: ${verifyUrl}` : ""}${footerText(brand)}`;
    return { html, text };
  },
  customer_password_reset: (brand, data, subject) => {
    const resetUrl = String(data.resetUrl ?? data.url ?? "");
    const html = layout(
      brand,
      subject,
      `${heading("Reset your password")}${para(`We received a request to reset your password for ${escapeHtml(brand.storeName)}. This link will expire in 1 hour.`)}${button("Reset password", resetUrl)}${para("If you didn't ask to reset your password, you can safely ignore this email.")}`,
    );
    const text = `Reset your password\n\nWe received a request to reset your password for ${brand.storeName}. This link will expire in 1 hour.\n\nReset password: ${resetUrl}\n\nIf you didn't ask to reset your password, you can safely ignore this email.${footerText(brand)}`;
    return { html, text };
  },
  customer_account_setup: (brand, data, subject) => {
    const setupUrl = String(data.setupUrl ?? data.resetUrl ?? data.url ?? "");
    const html = layout(
      brand,
      subject,
      `${heading(`Set up your account for ${escapeHtml(brand.storeName)}`)}${para("Thank you for signing up! Please click the button below to set your password and complete setting up your account.")}${setupUrl ? button("Set your password", setupUrl) : ""}${para("This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.")}`,
    );
    const text = `Set up your account for ${brand.storeName}\n\nThank you for signing up! Please visit the link below to set your password and complete setting up your account:\n\n${setupUrl}\n\nThis link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.${footerText(brand)}`;
    return { html, text };
  },
  // A general message: a heading, short paragraphs and an optional button. The notification dispatcher uses it for
  // events that go to store admins and Super Admin staff (platform brand) so each needs no template of its own.
  notice: (brand, data, subject) => {
    const head = String(data.heading ?? subject);
    const lines = Array.isArray(data.lines) ? data.lines.map((l) => String(l)) : [];
    const ctaUrl = typeof data.ctaUrl === "string" ? data.ctaUrl : "";
    const ctaLabel = typeof data.ctaLabel === "string" ? data.ctaLabel : "Open";
    const html = layout(brand, subject, `${heading(head)}${lines.map(para).join("")}${ctaUrl ? button(ctaLabel, ctaUrl) : ""}`, lines[0] ?? head);
    const text = `${head}\n\n${lines.join("\n\n")}${ctaUrl ? `\n\n${ctaLabel}: ${ctaUrl}` : ""}${footerText(brand)}`;
    return { html, text };
  },
  staff_new_order: (brand, data, subject) => {
    const o = data.order;
    const adminUrl = String(data.adminUrl ?? "");
    const customerName = String(data.customerName ?? "Customer");
    const html = layout(
      brand,
      subject,
      `${heading("New order received!")}${para(`Order ${o?.number ? escapeHtml(o.number) : ""} was placed by ${escapeHtml(customerName)} for ${o ? formatInr(o.grandTotal, o.currency) : ""}.`)}${adminUrl ? button("View order in admin", adminUrl) : ""}`,
    );
    const text = `New order received!\n\nOrder ${o?.number ?? ""} was placed by ${customerName} for ${o ? formatInr(o.grandTotal, o.currency) : ""}.\n\n${adminUrl ? `View order in admin: ${adminUrl}` : ""}${footerText(brand)}`;
    return { html, text };
  },
};

/** The email content for a template. Unknown templates still produce a readable email instead of a debug string. */
export function renderEmail(template: string, brand: EmailBrand, data: EmailData, subject: string): RenderedEmail {
  const builder = TEMPLATES[template];
  if (builder) return builder(brand, data, subject);
  const html = layout(brand, subject, `${heading(subject)}${data.order ? orderBlock(data.order).html : ""}`);
  return { html, text: `${subject}${data.order ? `\n\n${orderBlock(data.order).text}` : ""}${footerText(brand)}` };
}

export const EMAIL_TEMPLATES = Object.keys(TEMPLATES);
