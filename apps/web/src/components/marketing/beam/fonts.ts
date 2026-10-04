import { Geist } from "next/font/google";

/** Self-hosted by next/font at build time (no request from the visitor's browser goes to Google). */
export const bmFont = Geist({ subsets: ["latin"], variable: "--font-bm", display: "swap" });
