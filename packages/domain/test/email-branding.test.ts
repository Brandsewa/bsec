import { describe, expect, it } from "vitest";
import { DEFAULT_EMAIL_BRANDING, contrastRatio, parseEmailBranding, resolveEmailBranding } from "../src/system/email-branding.ts";
import { renderEmail, type EmailBrand, type EmailOrder } from "../src/system/email-templates.ts";

const order: EmailOrder = {
  number: "ORD-9",
  items: [{ title: "Candle", variant: "Lavender", quantity: 2, total: 40000 }],
  subtotal: 40000,
  discountTotal: 0,
  shippingTotal: 0,
  codFee: 0,
  grandTotal: 40000,
  paymentStatus: "paid",
  orderUrl: "https://shop.example.com/o/abc",
};
const brand = (branding = DEFAULT_EMAIL_BRANDING): EmailBrand => ({ storeName: "Taste of Hills", baseUrl: "https://shop.example.com", supportEmail: "help@shop.example.com", branding });

describe("email branding tokens", () => {
  it("accepts hex colours (short form too) and keeps buttons and links on the accent unless set", () => {
    const { tokens, issues } = parseEmailBranding({ accent: "#05a" });
    expect(tokens.accent).toBe("#0055aa");
    expect(tokens.buttonBackground).toBe("#0055aa");
    expect(tokens.linkColor).toBe("#0055aa");
    expect(issues).toEqual([]);
  });

  it("keeps explicit button and link colours apart from the accent", () => {
    const { tokens } = parseEmailBranding({ accent: "#0b6b42", buttonBackground: "#222222", linkColor: "#0645ad" });
    expect(tokens.buttonBackground).toBe("#222222");
    expect(tokens.linkColor).toBe("#0645ad");
  });

  it("rejects bad colours and reports them instead of breaking the email", () => {
    const { tokens, issues } = parseEmailBranding({ accent: "red", text: "url(javascript:1)" });
    expect(tokens.accent).toBe(DEFAULT_EMAIL_BRANDING.accent);
    expect(tokens.text).toBe(DEFAULT_EMAIL_BRANDING.text);
    expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(["accent", "text"]));
  });

  it("replaces unreadable button text so a button can never be saved illegible", () => {
    const { tokens, issues } = parseEmailBranding({ buttonBackground: "#ffffff", buttonText: "#fefefe" });
    expect(contrastRatio(tokens.buttonText, tokens.buttonBackground)).toBeGreaterThanOrEqual(4.5);
    expect(issues.some((i) => i.field === "buttonText")).toBe(true);
  });

  it("only accepts an https logo and https footer links", () => {
    expect(parseEmailBranding({ logoUrl: "http://x.test/logo.png" }).issues.some((i) => i.field === "logoUrl")).toBe(true);
    expect(parseEmailBranding({ logoUrl: "javascript:alert(1)" }).tokens.logoUrl).toBeNull();
    expect(parseEmailBranding({ logoUrl: "https://cdn.test/logo.png" }).tokens.logoUrl).toBe("https://cdn.test/logo.png");
    const links = parseEmailBranding({ footer: { links: [{ label: "Help", url: "https://x.test/help" }, { label: "Bad", url: "javascript:1" }] } }).tokens.footer.links;
    expect(links).toEqual([{ label: "Help", url: "https://x.test/help" }]);
  });

  it("limits the platform font and sizes to the allowed values", () => {
    const { tokens, issues } = parseEmailBranding({ fontFamily: "Comic Sans", baseFontSize: 40, headingScale: 9 });
    expect(tokens.fontFamily).toBe("system");
    expect(tokens.baseFontSize).toBe(15);
    expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(["fontFamily", "baseFontSize", "headingScale"]));
  });
});

describe("two layers: platform and store", () => {
  it("a store can set logo, colours and footer but never the fonts", () => {
    const platform = { fontFamily: "georgia", baseFontSize: 16, headingScale: 1.6, accent: "#112233" };
    const resolved = resolveEmailBranding(platform, { accent: "#aa0000", fontFamily: "verdana", baseFontSize: 18, footer: { text: "Thanks!" } });
    expect(resolved.accent).toBe("#aa0000");
    expect(resolved.footer.text).toBe("Thanks!");
    expect(resolved.fontFamily).toBe("georgia");
    expect(resolved.baseFontSize).toBe(16);
    expect(resolved.headingScale).toBe(1.6);
  });

  it("falls back to the platform look until a store sets anything", () => {
    expect(resolveEmailBranding({ accent: "#112233" }, undefined).accent).toBe("#112233");
    expect(resolveEmailBranding(undefined, undefined)).toEqual(DEFAULT_EMAIL_BRANDING);
  });
});

describe("responsive, modern email markup", () => {
  const { html, text } = renderEmail("order_confirmation", brand(), { order }, "Order ORD-9 confirmed");

  it("declares a viewport, a mobile breakpoint and stacked full-width buttons on phones", () => {
    expect(html).toContain('name="viewport"');
    expect(html).toContain("@media only screen and (max-width:620px)");
    expect(html).toContain("bs-btn");
    expect(html).toContain("max-width:600px");
  });

  it("uses table layout with presentation roles (works in Outlook and Gmail)", () => {
    expect(html).toContain('role="presentation"');
    expect(html).not.toContain("display:flex");
  });

  it("applies every colour token and leaves no placeholder behind", () => {
    const custom = parseEmailBranding({ accent: "#aa0000", buttonBackground: "#123456", buttonText: "#ffffff", linkColor: "#7700aa", footer: { links: [{ label: "FAQ", url: "https://shop.example.com/faq" }] } }).tokens;
    const r = renderEmail("order_shipped", brand(custom), { order, awb: "AWB1" }, "Shipped").html;
    expect(r).toContain("background:#123456");
    expect(r).toContain("#aa0000");
    expect(r).toContain("color:#7700aa");
    expect(r).toContain('href="https://shop.example.com/faq"');
    expect(r).not.toMatch(/%%\w+%%/);
    expect(html).not.toMatch(/%%\w+%%/);
  });

  it("shows the logo image when set and the store name as text otherwise", () => {
    const withLogo = renderEmail("order_confirmation", brand({ ...DEFAULT_EMAIL_BRANDING, logoUrl: "https://cdn.test/logo.png" }), { order }, "x").html;
    expect(withLogo).toContain('src="https://cdn.test/logo.png"');
    expect(withLogo).toContain('alt="Taste of Hills"');
    expect(html).not.toContain("<img");
  });

  it("scales the heading from the base size and font family tokens", () => {
    const big = parseEmailBranding({ fontFamily: "georgia", baseFontSize: 16, headingScale: 1.5 }).tokens;
    const r = renderEmail("order_confirmation", brand(big), { order }, "x").html;
    expect(r).toContain("font-size:24px");
    expect(r).toContain("Georgia");
  });

  it("escapes branding text so a footer cannot inject markup", () => {
    const t = parseEmailBranding({ footer: { text: '<script>alert(1)</script>Hello "you"' } }).tokens;
    const r = renderEmail("order_confirmation", brand(t), { order }, "x").html;
    expect(r).not.toContain("<script>");
    expect(r).toContain("Hello &quot;you&quot;");
  });

  it("keeps a plain-text twin that carries the footer details", () => {
    const t = parseEmailBranding({ footer: { address: "12 Hill Road, Dehradun", links: [{ label: "FAQ", url: "https://shop.example.com/faq" }] } }).tokens;
    const r = renderEmail("order_confirmation", brand(t), { order }, "x").text;
    expect(r).toContain("12 Hill Road, Dehradun");
    expect(r).toContain("FAQ: https://shop.example.com/faq");
    expect(text).not.toContain("<");
  });

  it("the general notice used for store and staff alerts renders with a button", () => {
    const n = renderEmail("notice", brand(), { heading: "New order ORD-9", lines: ["Asha placed an order for ₹400."], ctaUrl: "https://admin.example.com/orders/9", ctaLabel: "View order" }, "New order");
    expect(n.html).toContain("View order");
    expect(n.html).toContain('href="https://admin.example.com/orders/9"');
    expect(n.text).toContain("View order: https://admin.example.com/orders/9");
  });
});
