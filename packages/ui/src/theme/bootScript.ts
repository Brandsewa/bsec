/**
 * Inlines before paint to avoid flash of incorrect theme (FOUC).
 * Reads localStorage['bs-theme'], resolves 'system' against matchMedia,
 * and sets data-theme and colorScheme on documentElement.
 */
export const THEME_STORAGE_KEY = "bs-theme";

/**
 * Builds the boot script. `pathPattern` (a regex source) limits theming to matching paths, so the merchant
 * storefront (which has its own per-store look) never gets a dark colour-scheme from the visitor's OS.
 */
export function makeThemeBootScript(pathPattern?: string): string {
  const guard = pathPattern ? `if (!new RegExp(${JSON.stringify(pathPattern)}).test(location.pathname)) return;` : "";
  return `(function() {
  try {
    ${guard}
    var stored = localStorage.getItem("${THEME_STORAGE_KEY}") || "system";
    var resolved = stored;
    if (stored === "system") {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  } catch (e) {}
})();`;
}

export const themeBootScript = makeThemeBootScript();
