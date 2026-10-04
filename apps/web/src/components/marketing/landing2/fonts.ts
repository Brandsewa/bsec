import { Hind, Kalam, Young_Serif } from "next/font/google";

/** Self-hosted by next/font at build time (no request from the visitor's browser goes to Google). */
export const bkDisplayFont = Young_Serif({ subsets: ["latin"], weight: "400", variable: "--font-bk-display", display: "swap" });
export const bkBodyFont = Hind({ subsets: ["latin", "devanagari"], weight: ["400", "500", "600"], variable: "--font-bk-body", display: "swap" });
/** The shopkeeper's pen: used only for what is "written in" the ledger (entries, dates, notes). */
export const bkPenFont = Kalam({ subsets: ["latin", "devanagari"], weight: ["400", "700"], variable: "--font-bk-pen", display: "swap" });
