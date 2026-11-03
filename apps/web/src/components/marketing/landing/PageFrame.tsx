import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { isPlatformMarketingHost } from "@/server/hosts.ts";
import { HomeFooter } from "../home/HomeFooter.tsx";
import { HomeNav } from "../home/HomeNav.tsx";
import { HomeRoot } from "../home/HomeRoot.tsx";
import { siteHold } from "../home/SiteHold.tsx";

/**
 * Frame for the plain pages of the marketing site (about, contact, pricing, legal): the same header and footer as the
 * home page, a readable document column, mobile first. These pages exist only on the marketing host; every other host
 * (a store) gets a 404, so they can never shadow a store's own pages.
 */
export async function PageFrame({ children }: { children: ReactNode }) {
  const h = await headers();
  if (!isPlatformMarketingHost(h.get("x-forwarded-host") ?? h.get("host"))) notFound();
  const hold = await siteHold();
  return (
    <HomeRoot>
      <HomeNav />
      <main id="main">{hold ?? children}</main>
      <HomeFooter />
    </HomeRoot>
  );
}

export function DocHeader({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }) {
  return (
    <header className="doc-head">
      <div className="doc">
        <span className="kick">{eyebrow}</span>
        <h1>{title}</h1>
        {intro && <p className="lead">{intro}</p>}
      </div>
    </header>
  );
}

/** The document column under a DocHeader. */
export function DocBody({ children }: { children: ReactNode }) {
  return (
    <div className="doc-main">
      <article className="doc">{children}</article>
    </div>
  );
}
