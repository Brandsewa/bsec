import { describe, expect, it } from "vitest";
import { makeThemeBootScript } from "@bs/ui/server";
import { THEMED_PATH_SOURCE, isThemedPath } from "../src/lib/themed-paths.ts";

describe("themed paths (storefront keeps its own look)", () => {
  it("themes account, auth and token pages", () => {
    for (const p of ["/account", "/account/login", "/signup", "/o/abc", "/orders/t/thank-you", "/cod/x", "/unsubscribe/t", "/privacy-request"]) {
      expect(isThemedPath(p), p).toBe(true);
    }
  });

  it("does not theme storefront pages", () => {
    for (const p of ["/", "/products/shirt", "/collections/new", "/cart", "/checkout", "/search", "/pages/about", "/blog/x"]) {
      expect(isThemedPath(p), p).toBe(false);
    }
  });

  it("boot script only runs on themed paths", () => {
    const script = makeThemeBootScript(THEMED_PATH_SOURCE);
    const run = (pathname: string, dark: boolean) => {
      const root = { dataset: {} as Record<string, string>, style: { colorScheme: "" } };
      const fn = new Function("document", "location", "localStorage", "window", script);
      fn(
        { documentElement: root },
        { pathname },
        { getItem: () => null },
        { matchMedia: () => ({ matches: dark }) },
      );
      return root;
    };
    expect(run("/products/shirt", true).dataset.theme).toBeUndefined();
    expect(run("/account/login", true).dataset.theme).toBe("dark");
  });
});
