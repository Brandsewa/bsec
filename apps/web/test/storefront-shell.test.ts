import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { StoreHeader } from "../src/components/storefront/StoreHeader";
import { StoreFooter } from "../src/components/storefront/StoreFooter";
import { CartBadge } from "../src/components/storefront/CartBadge";
import { StoreStatusBanner } from "../src/components/storefront/StoreStatusBanner";
import {
  ComingSoonScreen,
  MaintenanceScreen,
  PasswordScreen,
  SuspendedScreen,
  ProvisioningScreen,
} from "../src/components/storefront/StoreStatusScreens";
import { computeThemeTokens } from "../src/components/storefront/theme-tokens";

describe("Storefront Shell & Components", () => {
  describe("computeThemeTokens()", () => {
    it("derives CSS variables from brand settings and theme tokens with defaults", () => {
      const vars = computeThemeTokens();
      expect(vars["--color-primary"]).toBeDefined();
      expect(vars["--color-secondary"]).toBeDefined();
      expect(vars["--color-accent"]).toBeDefined();
      expect(vars["--color-background"]).toBeDefined();
      expect(vars["--color-surface"]).toBeDefined();
      expect(vars["--color-text"]).toBeDefined();
      expect(vars["--font-heading"]).toBe("Inter");
      expect(vars["--font-body"]).toBe("Inter");
      expect(vars["--radius"]).toBeDefined();
    });

    it("applies custom brand settings and maps radius correctly", () => {
      const vars = computeThemeTokens({
        primaryColor: "#ff0000",
        secondaryColor: "#00ff00",
        accentColor: "#0000ff",
        backgroundColor: "#111111",
        surfaceColor: "#222222",
        textColor: "#ffffff",
        fontHeading: "Poppins",
        fontBody: "Roboto",
        cornerRadius: "large",
      });

      expect(vars["--color-primary"]).toBe("#ff0000");
      expect(vars["--color-secondary"]).toBe("#00ff00");
      expect(vars["--color-accent"]).toBe("#0000ff");
      expect(vars["--color-background"]).toBe("#111111");
      expect(vars["--color-surface"]).toBe("#222222");
      expect(vars["--color-text"]).toBe("#ffffff");
      expect(vars["--font-heading"]).toBe("Poppins");
      expect(vars["--font-body"]).toBe("Roboto");
      expect(vars["--radius"]).toBe("0.75rem");
    });

    it("sanitizes malicious or malformed CSS values and safely falls back to defaults", () => {
      const vars = computeThemeTokens({
        primaryColor: "; } body { display: none }",
        secondaryColor: "javascript:alert(1)",
        accentColor: "expression(alert(1))",
        backgroundColor: "red; background: url('https://evil.com/x.jpg')",
        surfaceColor: "#xyz123",
        textColor: "rgb(255, 0, 0); } * { display: none; }",
        fontHeading: "Arial; } * { color: red; }",
        fontBody: "Inter, sans-serif; font-size: 100px",
        cornerRadius: "20px; } body { opacity: 0; }",
      });

      expect(vars["--color-primary"]).toBe("#0f172a");
      expect(vars["--color-secondary"]).toBe("#334155");
      expect(vars["--color-accent"]).toBe("#2563eb");
      expect(vars["--color-background"]).toBe("#ffffff");
      expect(vars["--color-surface"]).toBe("#f8fafc");
      expect(vars["--color-text"]).toBe("#0f172a");
      expect(vars["--font-heading"]).toBe("Inter");
      expect(vars["--font-body"]).toBe("Inter");
      expect(vars["--radius"]).toBe("0.5rem");
    });
  });

  describe("StoreHeader", () => {
    it("renders store name, navigation items, search link, and cart badge", () => {
      const html = renderToString(
        React.createElement(StoreHeader, {
          storeName: "Test Store",
          cartItemCount: 3,
        }),
      );

      expect(html).toContain("Test Store");
      expect(html).toContain('href="/"');
      expect(html).toContain('href="/search"');
      expect(html).toContain('href="/collections"');
      expect(html).toContain('href="/about"');
      expect(html).toContain('href="/contact"');
      expect(html).toContain('href="/cart"');
      expect(html).toContain("3");
    });

    it("renders logo image if logoUrl is provided", () => {
      const html = renderToString(
        React.createElement(StoreHeader, {
          storeName: "Test Store",
          logoUrl: "https://example.com/logo.png",
          logoWidth: 160,
        }),
      );

      expect(html).toContain('src="https://example.com/logo.png"');
      expect(html).toContain('width="160"');
    });
  });

  describe("StoreFooter", () => {
    it("renders store links, policy links, copyright notice, and newsletter signup form", () => {
      const html = renderToString(
        React.createElement(StoreFooter, {
          storeName: "Acme Shop",
        }),
      );

      expect(html).toContain("Acme Shop");
      expect(html).toContain("/policies/privacy");
      expect(html).toContain("/policies/terms");
      expect(html).toContain("/policies/refund");
      expect(html).toContain("/policies/shipping");
      expect(html).toContain("/about");
      expect(html).toContain("/search");
      expect(html).toContain("/blog");
      expect(html).toContain('action="/api/storefront/newsletter/subscribe"');
      expect(html).toContain("type=\"email\"");
    });
  });

  describe("CartBadge", () => {
    it("renders item count and link to /cart", () => {
      const html = renderToString(
        React.createElement(CartBadge, {
          count: 5,
        }),
      );

      expect(html).toContain('href="/cart"');
      expect(html).toContain("5");
      expect(html).toContain("Cart");
    });
  });

  describe("StoreStatusBanner", () => {
    it("renders sticky bar when isBypass is true with current mode", () => {
      const html = renderToString(
        React.createElement(StoreStatusBanner, {
          isBypass: true,
          mode: "coming_soon",
        }),
      );

      expect(html).toContain("Staff Preview Mode: Store is currently in");
      expect(html).toContain("coming_soon");
      expect(html).toContain("mode.");
    });

    it("returns null or empty when isBypass is false", () => {
      const html = renderToString(
        React.createElement(StoreStatusBanner, {
          isBypass: false,
          mode: "coming_soon",
        }),
      );

      expect(html).toBe("");
    });
  });

  describe("StoreStatusScreens", () => {
    it("renders ComingSoonScreen with headline and newsletter", () => {
      const html = renderToString(
        React.createElement(ComingSoonScreen, {
          headline: "Something big is coming",
          collectEmails: true,
          showCountdown: true,
          launchAt: new Date(Date.now() + 86400000),
        }),
      );

      expect(html).toContain("Something big is coming");
      expect(html).toContain("email");
    });

    it("renders MaintenanceScreen with message", () => {
      const html = renderToString(
        React.createElement(MaintenanceScreen, {
          message: "Upgrading database. Back in 30 minutes.",
        }),
      );

      expect(html).toContain("Temporarily down for maintenance. Back soon.");
      expect(html).toContain("Upgrading database. Back in 30 minutes.");
    });

    it("renders PasswordScreen with password form", () => {
      const html = renderToString(
        React.createElement(PasswordScreen, {
          storeName: "VIP Store",
        }),
      );

      expect(html).toContain("VIP Store");
      expect(html).toContain('type="password"');
      expect(html).toContain("/api/storefront/status/verify-password");
    });

    it("renders SuspendedScreen", () => {
      const html = renderToString(React.createElement(SuspendedScreen));
      expect(html).toContain("This store is temporarily unavailable.");
    });

    it("renders ProvisioningScreen", () => {
      const html = renderToString(React.createElement(ProvisioningScreen));
      expect(html).toContain("Store setup in progress. Please check back shortly.");
    });
  });
});
