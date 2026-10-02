import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES, escapeHtml, formatInr, renderEmail, type EmailBrand, type EmailOrder } from "../src/system/email-templates.ts";

const brand: EmailBrand = { storeName: "Taste of Hills", baseUrl: "https://tasteofhills.gobs.cloud", supportEmail: "help@tasteofhills.example" };

const order: EmailOrder = {
  number: "ORD-00007",
  items: [
    { title: "Dalle Timboor Chok Pickle | Powder", variant: "Default", quantity: 2, total: 20000 },
    { title: "Gift box", variant: "Large", quantity: 1, total: 5000 },
  ],
  subtotal: 25000,
  discountTotal: 2500,
  shippingTotal: 9900,
  codFee: 0,
  grandTotal: 32400,
  paymentStatus: "cod_pending",
  shippingAddress: { fullName: "Asha Rana", addressLine1: "12 Hill Road", city: "Dehradun", state: "Uttarakhand", pincode: "248001" },
  orderUrl: "https://tasteofhills.gobs.cloud/o/ord_abc",
};

describe("money and escaping", () => {
  it("formats paise as rupees the way Indian shoppers read them", () => {
    expect(formatInr(10000)).toBe("₹100");
    expect(formatInr(123456)).toBe("₹1,234.56");
    expect(formatInr(0)).toBe("₹0");
  });

  it("escapes everything that could break out of the markup", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'q'`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;");
  });
});

describe("order confirmation email", () => {
  const { html, text } = renderEmail("order_confirmation", brand, { order }, "Order ORD-00007 confirmed");

  it("greets the shopper and shows the store, the order and the lines", () => {
    expect(html).toContain("Thank you for your order!");
    expect(html).toContain("Taste of Hills");
    expect(html).toContain("ORD-00007");
    expect(html).toContain("Dalle Timboor Chok Pickle | Powder");
    expect(html).toContain("× 2");
    expect(html).toContain("(Large)");
    expect(html).not.toContain("(Default)"); // the placeholder variant name is never shown
  });

  it("shows the money exactly as charged, including the discount and what is still due on delivery", () => {
    expect(text).toContain("Subtotal: ₹250");
    expect(text).toContain("Discount: -₹25");
    expect(text).toContain("Shipping: ₹99");
    expect(text).toContain("Total: ₹324");
    expect(text).toContain("Cash on delivery: please pay when your order arrives.");
  });

  it("links to the order and the delivery address, and has a plain-text twin", () => {
    expect(html).toContain('href="https://tasteofhills.gobs.cloud/o/ord_abc"');
    expect(html).toContain("12 Hill Road");
    expect(text).toContain("View your order: https://tasteofhills.gobs.cloud/o/ord_abc");
    expect(text).toContain("Dehradun, Uttarakhand");
    expect(text).not.toContain("<");
  });

  it("offers a way to ask questions", () => {
    expect(html).toContain("mailto:help@tasteofhills.example");
    expect(text).toContain("help@tasteofhills.example");
  });

  it("free shipping and no discount read plainly", () => {
    const plain = renderEmail("order_confirmation", brand, { order: { ...order, discountTotal: 0, shippingTotal: 0, grandTotal: 25000 } }, "x");
    expect(plain.text).toContain("Shipping: Free");
    expect(plain.text).not.toContain("Discount:");
  });
});

describe("other emails", () => {
  it("shipped: carrier and tracking number, and a Track link", () => {
    const r = renderEmail("order_shipped", brand, { order, carrier: "Delhivery", awb: "AWB12345" }, "Shipped");
    expect(r.text).toContain("Carrier: Delhivery.");
    expect(r.text).toContain("Tracking number: AWB12345.");
    expect(r.html).toContain("Track your order");
  });

  it("refund: says how much", () => {
    expect(renderEmail("refund_processed", brand, { order, refundAmount: 15000 }, "Refund").text).toContain("refund of ₹150 for order ORD-00007");
  });

  it("return, delivered, undeliverable", () => {
    expect(renderEmail("return_requested", brand, { order, returnNumber: "RET-1" }, "x").text).toContain("RET-1");
    expect(renderEmail("order_delivered", brand, { order }, "x").text).toContain("has been delivered");
    expect(renderEmail("order_rto", brand, { order }, "x").text).toContain("being returned to us");
  });

  it("abandoned cart: a button back to the cart", () => {
    const r = renderEmail("abandoned_cart_recovery", brand, { cartUrl: "https://tasteofhills.gobs.cloud/cart" }, "x");
    expect(r.html).toContain('href="https://tasteofhills.gobs.cloud/cart"');
    expect(r.text).toContain("Return to your cart: https://tasteofhills.gobs.cloud/cart");
  });

  it("an unknown template still produces a readable email, never a debug string", () => {
    const r = renderEmail("something_new", brand, { order }, "Something happened");
    expect(r.html).toContain("Something happened");
    expect(r.text).not.toContain("Template:");
  });

  it("every template used by the job handlers exists", () => {
    for (const t of [
      "order_confirmation",
      "order_shipped",
      "order_delivered",
      "order_rto",
      "return_requested",
      "refund_processed",
      "abandoned_cart_recovery",
      "password_reset",
      "password_changed",
      "customer_welcome",
      "customer_password_reset",
      "customer_account_setup",
    ]) {
      expect(EMAIL_TEMPLATES).toContain(t);
    }
  });

  it("password reset: includes the reset link and expiry note", () => {
    const r = renderEmail("password_reset", brand, { resetUrl: "https://admin.gobs.cloud/reset-password?token=xyz" }, "Reset password");
    expect(r.html).toContain('href="https://admin.gobs.cloud/reset-password?token=xyz"');
    expect(r.text).toContain("https://admin.gobs.cloud/reset-password?token=xyz");
    expect(r.text).toContain("expire in 1 hour");
  });

  it("password changed: security notice", () => {
    const r = renderEmail("password_changed", brand, {}, "Password changed");
    expect(r.text).toContain("Your password was changed");
    expect(r.text).toContain("All other active sessions have been signed out");
  });

  it("customer welcome and customer password reset: branded for store", () => {
    const welcome = renderEmail("customer_welcome", brand, { verifyUrl: "https://tasteofhills.gobs.cloud/account/verify-email/tok123" }, "Welcome");
    expect(welcome.text).toContain("Welcome to Taste of Hills!");
    expect(welcome.html).toContain("https://tasteofhills.gobs.cloud/account/verify-email/tok123");

    const reset = renderEmail("customer_password_reset", brand, { resetUrl: "https://tasteofhills.gobs.cloud/account/reset-password/tok456" }, "Reset password");
    expect(reset.text).toContain("Taste of Hills");
    expect(reset.html).toContain("https://tasteofhills.gobs.cloud/account/reset-password/tok456");

    const setup = renderEmail("customer_account_setup", brand, { setupUrl: "https://tasteofhills.gobs.cloud/account/reset-password/tok789" }, "Set up your account");
    expect(setup.text).toContain("Taste of Hills");
    expect(setup.html).toContain("https://tasteofhills.gobs.cloud/account/reset-password/tok789");
  });
});

describe("hostile text from a shopper or merchant", () => {
  it("is shown as text in the HTML, never executed", () => {
    const evil = { ...order, items: [{ title: `<img src=x onerror=alert(1)>`, variant: `"><b>`, quantity: 1, total: 100 }], shippingAddress: { fullName: `<script>steal()</script>`, city: "x" } };
    const { html } = renderEmail("order_confirmation", { ...brand, storeName: `Evil <i>Shop</i>` }, { order: evil }, "x");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("Evil &lt;i&gt;Shop&lt;/i&gt;");
  });
});
