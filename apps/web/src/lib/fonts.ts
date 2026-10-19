import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

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


/** Italic display serif for the marketing page's accent words (landing.css reads --font-serif-display). */
export const fontSerifDisplay = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif-display",
  display: "swap",
});
