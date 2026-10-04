import { Bricolage_Grotesque, Figtree } from "next/font/google";

/** Self-hosted by next/font at build time: no request from the visitor's browser goes to Google. */
export const bzDisplayFont = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-bz-display",
  display: "swap",
});

export const bzBodyFont = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-bz-body",
  display: "swap",
});
