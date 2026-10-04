import { Epilogue, Work_Sans } from "next/font/google";

/** Self-hosted by next/font at build time (no request from the visitor's browser goes to Google). */
export const nbDisplayFont = Epilogue({ subsets: ["latin"], weight: ["700", "800", "900"], variable: "--font-nb-display", display: "swap" });
export const nbBodyFont = Work_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-nb-body", display: "swap" });
