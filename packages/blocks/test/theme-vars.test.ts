import { describe, expect, it } from "vitest";
import { computeThemeTokens, resolveThemeColors, DEFAULT_THEME_COLORS } from "../src/theme-vars.ts";

const fg = (primary: string) => computeThemeTokens({ primaryColor: primary })["--bs-primary-fg"];

describe("--bs-primary-fg (text on the brand colour)", () => {
  it("is white on dark colours, including ones starting with 3 valid hex digits", () => {
    expect(fg("#0f172a")).toBe("#ffffff"); // regression: was read as #0f1 and came out dark-on-dark
    expect(fg("#000000")).toBe("#ffffff");
    expect(fg("#0b6b42")).toBe("#ffffff");
  });

  it("is dark on light colours", () => {
    expect(fg("#ffffff")).toBe("#0f172a");
    expect(fg("#fff")).toBe("#0f172a");
    expect(fg("#f5a623")).toBe("#0f172a");
  });

  it("falls back safely for non-hex colours", () => {
    expect(fg("rgb(10, 20, 30)")).toBe("#ffffff");
  });
});

describe("heading sizes", () => {
  it("emits rem variables for every level and device, defaulting to the original block sizes", () => {
    const v = computeThemeTokens(null, {});
    expect(v["--bs-h1-d"]).toBe("3.75rem");
    expect(v["--bs-h1-m"]).toBe("2.25rem");
    expect(v["--bs-h2-d"]).toBe("2.25rem");
    expect(v["--bs-h6-t"]).toBe("0.875rem");
    expect(Object.keys(v).filter((k) => /^--bs-h[1-6]-[dtm]$/.test(k))).toHaveLength(18);
  });

  it("applies a theme's own sizes per device, clamps them and ignores unusable values", () => {
    const v = computeThemeTokens(null, { fontSizes: { h1: { desktop: 72, tablet: 4, mobile: "x" }, h2: { desktop: 1000 } } });
    expect(v["--bs-h1-d"]).toBe("4.5rem");
    expect(v["--bs-h1-t"]).toBe("0.75rem"); // clamped up to 12px
    expect(v["--bs-h1-m"]).toBe("2.25rem"); // not a number: default
    expect(v["--bs-h2-d"]).toBe("7.5rem"); // clamped down to 120px
    expect(v["--bs-h2-m"]).toBe("1.75rem"); // untouched
  });

  it("never lets a theme inject anything but numbers into the stylesheet", () => {
    const v = computeThemeTokens(null, { fontSizes: { h1: { desktop: "60px; background:url(x)" as never } } });
    expect(v["--bs-h1-d"]).toBe("3.75rem");
  });
});

describe("font weights and button colours", () => {
  it("defaults to the original weights and button look", () => {
    const v = computeThemeTokens({ primaryColor: "#0b6b42" });
    expect(v["--bs-heading-weight"]).toBe("700");
    expect(v["--bs-body-weight"]).toBe("400");
    expect(v["--bs-btn-dark-bg"]).toBe("#0b6b42");
    expect(v["--bs-btn-dark-fg"]).toBe("#ffffff");
    expect(v["--bs-btn-light-bg"]).toBe(v["--color-surface"]);
    expect(v["--bs-btn-light-fg"]).toBe(v["--color-text"]);
  });

  it("applies chosen weights and the dark/light button colours, and ignores unusable values", () => {
    const v = computeThemeTokens(null, {
      colors: { primary: "#1f3a5f" },
      fonts: { headingWeight: 600, bodyWeight: "500" },
      buttons: { darkBg: "#111111", darkText: "#fafafa", lightBg: "#e0f2fe", lightText: "#075985" },
    });
    expect(v["--bs-heading-weight"]).toBe("600");
    expect(v["--bs-body-weight"]).toBe("500");
    expect(v["--bs-btn-bg"]).toBe("#111111");
    expect(v["--bs-btn-fg"]).toBe("#fafafa");
    expect(v["--bs-btn-light-bg"]).toBe("#e0f2fe");
    expect(v["--bs-btn-light-bd"]).toBe("#e0f2fe");
    const bad = computeThemeTokens(null, { fonts: { headingWeight: 950, bodyWeight: "bold" }, buttons: { darkBg: "red; x", lightText: "url(x)" } });
    expect(bad["--bs-heading-weight"]).toBe("700");
    expect(bad["--bs-body-weight"]).toBe("400");
    expect(bad["--bs-btn-dark-bg"]).toBe(bad["--color-primary"]);
  });

  it("derives the outline and soft styles from the dark button colour", () => {
    const outline = computeThemeTokens(null, { buttons: { style: "outline", darkBg: "#7c3aed" } });
    expect(outline["--bs-btn-bd"]).toBe("#7c3aed");
    expect(outline["--bs-btn-fg"]).toBe("#7c3aed");
  });
});

describe("body text sizes", () => {
  it("default to 16px on every device and emit rem variables", () => {
    const v = computeThemeTokens(null, {});
    expect(v["--bs-body-d"]).toBe("1rem");
    expect(v["--bs-body-t"]).toBe("1rem");
    expect(v["--bs-body-m"]).toBe("1rem");
  });

  it("follow the theme per device and stay inside 12 to 24px", () => {
    const v = computeThemeTokens(null, { fontSizes: { body: { desktop: 18, tablet: 17, mobile: 100 } } });
    expect(v["--bs-body-d"]).toBe("1.125rem");
    expect(v["--bs-body-t"]).toBe("1.0625rem");
    expect(v["--bs-body-m"]).toBe("1.5rem");
    expect(computeThemeTokens(null, { fontSizes: { body: { mobile: "abc" } } })["--bs-body-m"]).toBe("1rem");
  });

  it("do not disturb the heading sizes", () => {
    const v = computeThemeTokens(null, { fontSizes: { body: { desktop: 20 }, h1: { desktop: 70 } } });
    expect(v["--bs-h1-d"]).toBe("4.375rem");
  });
});

describe("dark background colours", () => {
  it("default to a dark slate with white text", () => {
    const v = computeThemeTokens(null, {});
    expect(v["--bs-dark"]).toBe("#0f172a");
    expect(v["--bs-on-dark"]).toBe("#ffffff");
  });

  it("use the theme's own colours, and pick readable text when only the background is set", () => {
    const own = computeThemeTokens(null, { colors: { dark: "#10231a", textOnDark: "#f4f7f5" } });
    expect(own["--bs-dark"]).toBe("#10231a");
    expect(own["--bs-on-dark"]).toBe("#f4f7f5");
    expect(computeThemeTokens(null, { colors: { dark: "#fde68a" } })["--bs-on-dark"]).toBe("#0f172a");
  });

  it("ignore values that are not colours", () => {
    expect(computeThemeTokens(null, { colors: { dark: "red; background: url(x)" } })["--bs-dark"]).toBe("#0f172a");
  });
});

describe("global layout theme settings (Site Width, Section & Container defaults)", () => {
  it("emits default site widths for desktop, tablet, and mobile", () => {
    const v = computeThemeTokens(null, {});
    expect(v["--bs-site-w-d"]).toBe("1200px");
    expect(v["--bs-site-w-t"]).toBe("100%");
    expect(v["--bs-site-w-m"]).toBe("100%");
  });

  it("applies custom site width in px, %, and rem", () => {
    const v1 = computeThemeTokens(null, { layout: { desktop: { siteWidth: "1440px" }, tablet: { siteWidth: "90%" }, mobile: { siteWidth: "100%" } } });
    expect(v1["--bs-site-w-d"]).toBe("1440px");
    expect(v1["--bs-site-w-t"]).toBe("90%");
    expect(v1["--bs-site-w-m"]).toBe("100%");

    // Automatically normalizes bare numbers to px
    const v2 = computeThemeTokens(null, { layout: { desktop: { siteWidth: "1280" as never } } });
    expect(v2["--bs-site-w-d"]).toBe("1280px");
  });

  it("emits section and container margin, padding, and sizing variables per device", () => {
    const v = computeThemeTokens(null, {
      layout: {
        desktop: {
          siteWidth: "1200px",
          section: {
            padding: { top: "40px", right: "20px", bottom: "40px", left: "20px" },
            margin: { top: "10px", bottom: "10px" },
            sizing: { width: "100%", maxWidth: "100%" },
          },
          container: {
            padding: { top: "24px", right: "16px", bottom: "24px", left: "16px" },
            margin: { left: "auto", right: "auto" },
            sizing: { maxWidth: "1140px" },
          },
        },
        mobile: {
          siteWidth: "100%",
          section: {
            padding: { top: "20px", right: "12px", bottom: "20px", left: "12px" },
          },
          container: {
            padding: { top: "16px", right: "8px", bottom: "16px", left: "8px" },
          },
        },
      },
    });

    // Desktop Section
    expect(v["--bs-sec-d-pt"]).toBe("40px");
    expect(v["--bs-sec-d-pr"]).toBe("20px");
    expect(v["--bs-sec-d-pb"]).toBe("40px");
    expect(v["--bs-sec-d-pl"]).toBe("20px");
    expect(v["--bs-sec-d-mt"]).toBe("10px");
    expect(v["--bs-sec-d-mb"]).toBe("10px");
    expect(v["--bs-sec-d-w"]).toBe("100%");
    expect(v["--bs-sec-d-mxw"]).toBe("100%");

    // Desktop Container
    expect(v["--bs-cnt-d-pt"]).toBe("24px");
    expect(v["--bs-cnt-d-pr"]).toBe("16px");
    expect(v["--bs-cnt-d-pb"]).toBe("24px");
    expect(v["--bs-cnt-d-pl"]).toBe("16px");
    expect(v["--bs-cnt-d-ml"]).toBe("auto");
    expect(v["--bs-cnt-d-mr"]).toBe("auto");
    expect(v["--bs-cnt-d-mxw"]).toBe("1140px");

    // Mobile Section & Container
    expect(v["--bs-sec-m-pt"]).toBe("20px");
    expect(v["--bs-sec-m-pr"]).toBe("12px");
    expect(v["--bs-cnt-m-pt"]).toBe("16px");
    expect(v["--bs-cnt-m-pr"]).toBe("8px");
  });

  it("filters out unsafe or invalid layout values", () => {
    const v = computeThemeTokens(null, {
      layout: {
        desktop: {
          siteWidth: "evil; background:red",
          section: { padding: { top: "javascript:alert(1)" as never } },
        },
      },
    });
    expect(v["--bs-site-w-d"]).toBe("1200px"); // safely fell back to default
    expect(v["--bs-sec-d-pt"]).toBeUndefined();
  });
});

describe("global color system (15-key Categorized Palettes & Presets)", () => {
  it("resolves all 15 color keys with sensible defaults when empty", () => {
    const colors = resolveThemeColors(null, {});
    expect(colors.siteBackground).toBe("#ffffff");
    expect(colors.primary).toBe("#0f172a");
    expect(colors.secondary).toBe("#334155");
    expect(colors.accent1).toBe("#2563eb");
    expect(colors.accent2).toBe("#f59e0b");
    expect(colors.lightHeading).toBe("#0f172a");
    expect(colors.lightText).toBe("#334155");
    expect(colors.lightButton).toBe("#0f172a");
    expect(colors.lightButtonText).toBe("#ffffff");
    expect(colors.lightBackground).toBe("#f8fafc");
    expect(colors.darkHeading).toBe("#ffffff");
    expect(colors.darkText).toBe("#ffffff");
    expect(colors.darkButton).toBe("#ffffff");
    expect(colors.darkButtonText).toBe("#0f172a");
    expect(colors.darkBackground).toBe("#0f172a");

    // Also provides legacy backward-compatible keys
    expect(colors.background).toBe("#ffffff");
    expect(colors.accent).toBe("#2563eb");
    expect(colors.surface).toBe("#f8fafc");
    expect(colors.text).toBe("#334155");
    expect(colors.dark).toBe("#0f172a");
    expect(colors.textOnDark).toBe("#ffffff");
  });

  it("maps branding primaryColor and custom colors into 15 keys", () => {
    const colors = resolveThemeColors({ primaryColor: "#0b6b42" }, {
      colors: {
        siteBackground: "#f9fafb",
        secondary: "#1f2937",
        accent1: "#10b981",
        accent2: "#f59e0b",
        lightHeading: "#111827",
        lightButton: "#0b6b42",
        lightButtonText: "#ffffff",
        darkBackground: "#10231a",
      },
    });
    expect(colors.siteBackground).toBe("#f9fafb");
    expect(colors.primary).toBe("#0b6b42");
    expect(colors.secondary).toBe("#1f2937");
    expect(colors.accent1).toBe("#10b981");
    expect(colors.accent2).toBe("#f59e0b");
    expect(colors.lightHeading).toBe("#111827");
    expect(colors.lightButton).toBe("#0b6b42");
    expect(colors.darkBackground).toBe("#10231a");
  });

  it("emits all CSS variables for the 15 color tokens", () => {
    const v = computeThemeTokens(null, {
      colors: {
        siteBackground: "#fdfbf7",
        primary: "#c2410c",
        secondary: "#44403c",
        accent1: "#eab308",
        accent2: "#f97316",
        lightHeading: "#2a1a10",
        lightText: "#44403c",
        lightButton: "#c2410c",
        lightButtonText: "#ffffff",
        lightBackground: "#fdf1e7",
        darkHeading: "#fffbf7",
        darkText: "#d6d3d1",
        darkButton: "#ea580c",
        darkButtonText: "#ffffff",
        darkBackground: "#2a1a10",
      },
    });
    expect(v["--bs-site-bg"]).toBe("#fdfbf7");
    expect(v["--bs-primary"]).toBe("#c2410c");
    expect(v["--bs-secondary"]).toBe("#44403c");
    expect(v["--bs-accent1"]).toBe("#eab308");
    expect(v["--bs-accent2"]).toBe("#f97316");
    expect(v["--bs-light-heading"]).toBe("#2a1a10");
    expect(v["--bs-light-text"]).toBe("#44403c");
    expect(v["--bs-light-btn-bg"]).toBe("#c2410c");
    expect(v["--bs-light-btn-fg"]).toBe("#ffffff");
    expect(v["--bs-light-bg"]).toBe("#fdf1e7");
    expect(v["--bs-dark-heading"]).toBe("#fffbf7");
    expect(v["--bs-dark-text"]).toBe("#d6d3d1");
    expect(v["--bs-dark-btn-bg"]).toBe("#ea580c");
    expect(v["--bs-dark-btn-fg"]).toBe("#ffffff");
    expect(v["--bs-dark-bg"]).toBe("#2a1a10");

    // Preserves legacy tokens for backward compatibility
    expect(v["--color-background"]).toBe("#fdfbf7");
    expect(v["--color-primary"]).toBe("#c2410c");
    expect(v["--color-surface"]).toBe("#fdf1e7");
    expect(v["--color-text"]).toBe("#44403c");
  });
});
