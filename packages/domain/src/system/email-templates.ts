/**
 * Transactional email content (HTML + plain text). Pure: no database, no network. The sender loads the store and the
 * order and hands them in, so these functions are easy to test and can never leak another store's data.
 * All amounts are paise; every piece of shopper- or merchant-provided text is HTML-escaped.
 */

export interface EmailBrand {
  storeName: string;
  /** The store's public address, e.g. https://tasteofhills.gobs.cloud (no trailing slash). */
  baseUrl: string;
  supportEmail?: string | null | undefined;
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
}

export interface EmailData {
  order?: EmailOrder | undefined;
  awb?: string | undefined;
  carrier?: string | undefined;
  returnNumber?: string | undefined;
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

export function formatInr(paise: number): string {
  const rupees = (Number.isFinite(paise) ? paise : 0) / 100;
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: rupees % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
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

const ACCENT = "#1f6f4a";

function layout(brand: EmailBrand, title: string, bodyHtml: string): string {
  const support = brand.supportEmail ? `<p style="margin:8px 0 0">Questions? Reply to this email or write to <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:${ACCENT}">${escapeHtml(brand.supportEmail)}</a>.</p>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f4f5f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1f1d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="padding:20px 28px;border-bottom:1px solid #e6e8e6"><a href="${escapeHtml(brand.baseUrl)}" style="font-size:20px;font-weight:700;color:#1c1f1d;text-decoration:none">${escapeHtml(brand.storeName)}</a></td></tr>
<tr><td style="padding:28px">${bodyHtml}</td></tr>
<tr><td style="padding:18px 28px;background:#fafbfa;font-size:12px;color:#6b726e;border-top:1px solid #e6e8e6">
<p style="margin:0">${escapeHtml(brand.storeName)} · <a href="${escapeHtml(brand.baseUrl)}" style="color:#6b726e">${escapeHtml(brand.baseUrl.replace(/^https?:\/\//, ""))}</a></p>${support}
</td></tr></table></td></tr></table></body></html>`;
}

function button(label: string, href: string): string {
  return `<p style="margin:24px 0 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${escapeHtml(label)}</a></p>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">${escapeHtml(text)}</h1>`;
}

function para(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${escapeHtml(text)}</p>`;
}

function orderBlock(o: EmailOrder): { html: string; text: string } {
  const rows = o.items
    .map(
      (it) =>
        `<tr><td style="padding:8px 0;font-size:14px;border-bottom:1px solid #eef0ee">${escapeHtml(it.title)}${it.variant && it.variant !== "Default" ? ` <span style="color:#6b726e">(${escapeHtml(it.variant)})</span>` : ""} × ${it.quantity}</td><td align="right" style="padding:8px 0;font-size:14px;border-bottom:1px solid #eef0ee;white-space:nowrap">${formatInr(it.total)}</td></tr>`,
    )
    .join("");
  const line = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:4px 0;font-size:14px;${bold ? "font-weight:700;" : "color:#4b524e;"}">${escapeHtml(label)}</td><td align="right" style="padding:4px 0;font-size:14px;${bold ? "font-weight:700;" : ""}">${value}</td></tr>`;
  const totals = [
    line("Subtotal", formatInr(o.subtotal)),
    o.discountTotal > 0 ? line("Discount", `−${formatInr(o.discountTotal)}`) : "",
    line("Shipping", o.shippingTotal === 0 ? "Free" : formatInr(o.shippingTotal)),
    o.codFee > 0 ? line("Cash on delivery fee", formatInr(o.codFee)) : "",
    line("Total", formatInr(o.grandTotal), true),
  ].join("");
  const addr = addressLines(o.shippingAddress);
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 8px"><tr><td style="font-size:13px;color:#6b726e;padding-bottom:6px">Order <strong style="color:#1c1f1d">${escapeHtml(o.number)}</strong></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">${totals}</table>
<p style="margin:14px 0 0;font-size:14px">${escapeHtml(paymentLine(o.paymentStatus))}</p>
${addr.length ? `<p style="margin:14px 0 0;font-size:13px;color:#4b524e"><strong>Delivering to</strong><br>${addr.map(escapeHtml).join("<br>")}</p>` : ""}`;
  const text = [
    `Order ${o.number}`,
    ...o.items.map((it) => `- ${it.title}${it.variant && it.variant !== "Default" ? ` (${it.variant})` : ""} x ${it.quantity}: ${formatInr(it.total)}`),
    `Subtotal: ${formatInr(o.subtotal)}`,
    ...(o.discountTotal > 0 ? [`Discount: -${formatInr(o.discountTotal)}`] : []),
    `Shipping: ${o.shippingTotal === 0 ? "Free" : formatInr(o.shippingTotal)}`,
    ...(o.codFee > 0 ? [`Cash on delivery fee: ${formatInr(o.codFee)}`] : []),
    `Total: ${formatInr(o.grandTotal)}`,
    paymentLine(o.paymentStatus),
    ...(addr.length ? ["", "Delivering to:", ...addr] : []),
  ].join("\n");
  return { html, text };
}

function footerText(brand: EmailBrand): string {
  return `\n\n${brand.storeName}\n${brand.baseUrl}${brand.supportEmail ? `\nQuestions? ${brand.supportEmail}` : ""}\n`;
}

// --- templates ------------------------------------------------------------------------------------------------------

type Builder = (brand: EmailBrand, data: EmailData, subject: string) => RenderedEmail;

function orderEmail(opts: { title: string; intro: (d: EmailData) => string; extra?: (d: EmailData) => string; cta?: string }): Builder {
  return (brand, data, subject) => {
    const o = data.order;
    const intro = opts.intro(data);
    const extra = opts.extra?.(data) ?? "";
    const block = o ? orderBlock(o) : null;
    const html = layout(
      brand,
      subject,
      `${heading(opts.title)}${para(intro)}${extra ? para(extra) : ""}${block ? block.html : ""}${o?.orderUrl ? button(opts.cta ?? "View your order", o.orderUrl) : ""}`,
    );
    const text = `${opts.title}\n\n${intro}${extra ? `\n${extra}` : ""}${block ? `\n\n${block.text}` : ""}${o?.orderUrl ? `\n\n${opts.cta ?? "View your order"}: ${o.orderUrl}` : ""}${footerText(brand)}`;
    return { html, text };
  };
}

const TEMPLATES: Record<string, Builder> = {
  order_confirmation: orderEmail({
    title: "Thank you for your order!",
    intro: (d) => `We have received your order${d.order ? ` ${d.order.number}` : ""} and will let you know when it ships.`,
  }),
  order_shipped: orderEmail({
    title: "Your order is on its way",
    intro: (d) => `Good news: order${d.order ? ` ${d.order.number}` : ""} has shipped.`,
    extra: (d) => [d.carrier ? `Carrier: ${d.carrier}.` : "", d.awb ? `Tracking number: ${d.awb}.` : ""].filter(Boolean).join(" "),
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
      `We have processed a refund${typeof d.refundAmount === "number" && d.refundAmount > 0 ? ` of ${formatInr(d.refundAmount)}` : ""}${d.order ? ` for order ${d.order.number}` : ""}. It can take a few days to show in your account.`,
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
};

/** The email content for a template. Unknown templates still produce a readable email instead of a debug string. */
export function renderEmail(template: string, brand: EmailBrand, data: EmailData, subject: string): RenderedEmail {
  const builder = TEMPLATES[template];
  if (builder) return builder(brand, data, subject);
  const html = layout(brand, subject, `${heading(subject)}${data.order ? orderBlock(data.order).html : ""}`);
  return { html, text: `${subject}${data.order ? `\n\n${orderBlock(data.order).text}` : ""}${footerText(brand)}` };
}

export const EMAIL_TEMPLATES = Object.keys(TEMPLATES);
