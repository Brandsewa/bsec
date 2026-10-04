import { Reenie_Beanie, Schibsted_Grotesk, Unbounded } from "next/font/google";

/** Self-hosted by next/font at build time (no request from the visitor's browser goes to Google). */
export const rzDisplayFont = Unbounded({ subsets: ["latin"], weight: ["700", "800", "900"], variable: "--font-rz-display", display: "swap" });
export const rzBodyFont = Schibsted_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-rz-body", display: "swap" });
/** The marker scrawl in the margins of the zine. */
export const rzScrawlFont = Reenie_Beanie({ subsets: ["latin"], weight: "400", variable: "--font-rz-scrawl", display: "swap" });
