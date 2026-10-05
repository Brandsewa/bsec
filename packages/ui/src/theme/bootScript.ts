/**
 * Inlines before paint to avoid flash of incorrect theme (FOUC).
 * Reads localStorage['bs-theme'], resolves 'system' against matchMedia,
 * and sets data-theme and colorScheme on documentElement.
 */
export const THEME_STORAGE_KEY = "bs-theme";

export const themeBootScript = `(function() {
  try {
    var stored = localStorage.getItem("${THEME_STORAGE_KEY}") || "system";
    var resolved = stored;
    if (stored === "system") {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  } catch (e) {}
})();`;
