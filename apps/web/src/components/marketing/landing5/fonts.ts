import { Albert_Sans, Sora } from "next/font/google";

/** Self-hosted by next/font at build time (no request from the visitor's browser goes to Google). */
export const skDisplayFont = Sora({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-sk-display", display: "swap" });
export const skBodyFont = Albert_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sk-body", display: "swap" });
