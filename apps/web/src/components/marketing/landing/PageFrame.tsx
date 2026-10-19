import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { fontSerifDisplay } from "@/lib/fonts.ts";
import { isPlatformMarketingHost } from "@/server/hosts.ts";
import { Nav } from "./sections/Nav.tsx";
import { SiteFooter } from "./sections/Footer.tsx";
import "./landing.css";

/**
 * Frame for the plain pages of the marketing site (about, contact, pricing, legal): the same header and footer as the
 * home page, a readable document column, mobile first. These pages exist only on the marketing host; every other host
 * (a store) gets a 404, so they can never shadow a store's own pages.
 */
export async function PageFrame({ children }: { children: ReactNode }) {
  const h = await headers();
  if (!isPlatformMarketingHost(h.get("x-forwarded-host") ?? h.get("host"))) notFound();
  return (
    <div className={`lp lp-doc ${fontSerifDisplay.variable}`} id="top">
      <Nav />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function DocHeader({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }) {
  return (
    <header className="doc-head">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {intro && <p className="lead">{intro}</p>}
    </header>
  );
}
