/**
 * Server-safe entry for @bs/ui (no hooks, no "use client").
 * Safe for React Server Components in Next.js and server environments.
 */

export { THEME_STORAGE_KEY, themeBootScript, makeThemeBootScript } from "./theme/bootScript.ts";
export { deriveAccent, type DerivedAccent } from "./theme/accent.ts";
