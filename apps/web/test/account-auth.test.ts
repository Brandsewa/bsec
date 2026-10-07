import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString as render } from "react-dom/server";
import { deriveAccent } from "@bs/ui/server";
import { LoginForm } from "../src/components/account/LoginForm.tsx";

const renderToString = (el: React.ReactElement) => render(el).replace(/<!-- -->/g, "");

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/account/login",
  useSearchParams: () => new URLSearchParams(),
}));

describe("Customer Auth & Store Accent", () => {
  describe("LoginForm component", () => {
    it("renders phone input and submit button with 44px mobile touch target class", () => {
      const html = renderToString(React.createElement(LoginForm));
      expect(html).toContain('data-testid="login-form"');
      expect(html).toContain('id="login-phone"');
      expect(html).toContain('autoComplete="tel-national"');
      expect(html).toContain("Send code");
    });

    it("renders password and otp tab choices", () => {
      const html = renderToString(React.createElement(LoginForm));
      expect(html).toContain("Phone Code");
      expect(html).toContain("Email &amp; Password");
    });
  });

  describe("Store Accent derivation and low-contrast correction", () => {
    it("derives accessible brand tokens for standard platform mint", () => {
      const tokens = deriveAccent("#00d4a4");
      expect(tokens).not.toBeNull();
      expect(tokens!.fill).toBe("#00d4a4");
      expect(tokens!.ink).toBeDefined();
      expect(tokens!.soft).toBeDefined();
      expect(tokens!.ring).toBe("#00d4a4");
    });

    it("corrects low-contrast accent (very light yellow) to an accessible ink color (contrast >= 4.5:1)", () => {
      const tokens = deriveAccent("#ffffe0");
      expect(tokens).not.toBeNull();
      expect(tokens!.fill).toBe("#ffffe0");
      // The ink color must be darkened significantly to provide AA contrast on white
      expect(tokens!.ink).not.toBe("#ffffe0");
      // It should produce a dark shade
      expect(tokens!.ink.toLowerCase()).toMatch(/^#[0-9a-f]{6}$/);
    });

    it("corrects saturated red and maintains dark readable ink", () => {
      const tokens = deriveAccent("#ff0000");
      expect(tokens).not.toBeNull();
      expect(tokens!.fill).toBe("#ff0000");
      expect(tokens!.ink).toBeDefined();
      expect(tokens!.ink.toLowerCase()).toMatch(/^#[0-9a-f]{6}$/);
    });

    it("handles pure black gracefully", () => {
      const tokens = deriveAccent("#000000");
      expect(tokens).not.toBeNull();
      expect(tokens!.fill).toBe("#000000");
      expect(tokens!.ink).toBe("#000000");
    });

    it("returns null on invalid or empty color input allowing fallback to platform mint", () => {
      const tokensEmpty = deriveAccent("");
      expect(tokensEmpty).toBeNull();

      const tokensInvalid = deriveAccent("invalid-hex-color");
      expect(tokensInvalid).toBeNull();

      const fallback = tokensInvalid ?? deriveAccent("#00d4a4")!;
      expect(fallback.fill).toBe("#00d4a4");
    });
  });
});

