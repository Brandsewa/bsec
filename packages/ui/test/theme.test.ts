import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeThemeBootScript, THEME_STORAGE_KEY } from "../src/theme/bootScript.ts";

describe("Theme Robustness & Boot Script Tests (Part 8)", () => {
  let mockStorage: Record<string, string>;
  let mockDocumentElement: {
    dataset: Record<string, string>;
    style: { colorScheme?: string | undefined; removeProperty: (prop: string) => void };
    removeAttribute: (attr: string) => void;
  };
  let mockLocation: { pathname: string };
  let mockMatchMedia: (query: string) => { matches: boolean };

  beforeEach(() => {
    mockStorage = {};
    mockDocumentElement = {
      dataset: {},
      style: {
        colorScheme: undefined,
        removeProperty: vi.fn(),
      },
      removeAttribute: vi.fn(),
    };
    mockLocation = { pathname: "/" };
    mockMatchMedia = (query: string) => ({ matches: query.includes("dark") });
  });

  function runBootScript(script: string) {
    const fn = new Function(
      "localStorage",
      "document",
      "window",
      "location",
      `
      return ${script};
      `
    );
    const mockWindow = { matchMedia: mockMatchMedia };
    const mockLocalStore = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
    };
    const mockDoc = {
      documentElement: mockDocumentElement,
    };
    return fn(mockLocalStore, mockDoc, mockWindow, mockLocation);
  }

  it("makeThemeBootScript outputs valid self-executing JavaScript", () => {
    const script = makeThemeBootScript();
    expect(script).toContain("(function()");
    expect(script).toContain(THEME_STORAGE_KEY);
    expect(script).toContain("document.documentElement.dataset.theme");
    expect(script).toContain("document.documentElement.style.colorScheme");
  });

  it("boot script resolves stored 'light' preference correctly", () => {
    mockStorage[THEME_STORAGE_KEY] = "light";
    const script = makeThemeBootScript();
    runBootScript(script);

    expect(mockDocumentElement.dataset.theme).toBe("light");
    expect(mockDocumentElement.style.colorScheme).toBe("light");
  });

  it("boot script resolves stored 'dark' preference correctly", () => {
    mockStorage[THEME_STORAGE_KEY] = "dark";
    const script = makeThemeBootScript();
    runBootScript(script);

    expect(mockDocumentElement.dataset.theme).toBe("dark");
    expect(mockDocumentElement.style.colorScheme).toBe("dark");
  });

  it("boot script defaults to system preference when no storage key exists", () => {
    const script = makeThemeBootScript();
    runBootScript(script);

    // matchMedia matches 'dark'
    expect(mockDocumentElement.dataset.theme).toBe("dark");
    expect(mockDocumentElement.style.colorScheme).toBe("dark");
  });

  it("boot script respects pathPattern guard for scoped theming", () => {
    mockLocation.pathname = "/store/catalog";
    mockStorage[THEME_STORAGE_KEY] = "dark";
    const script = makeThemeBootScript("^/(account|signup)");
    runBootScript(script);

    // Guard should have returned early without setting dataset.theme
    expect(mockDocumentElement.dataset.theme).toBeUndefined();

    // Now set matching pathname
    mockLocation.pathname = "/account/orders";
    runBootScript(script);
    expect(mockDocumentElement.dataset.theme).toBe("dark");
  });
});
