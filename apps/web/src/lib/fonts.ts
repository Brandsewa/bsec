import { Geist, Geist_Mono } from "next/font/google";

/**
 * Self-hosted by next/font at build time (no request goes to Google at runtime).
 * Exposes --font-sans and --font-mono matching Vite @fontsource / @bs/ui definitions.
 */
export const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

/** Compatibility export for beam marketing font */
export const bmFont = fontSans;
