"use client";

import { createContext, type ReactNode } from "react";
import type { BrandLogoPair, MkHeaderProps } from "@bs/blocks";

export interface SiteNavLink {
  label: string;
  href: string;
}

export interface SiteNav {
  /** Header links saved under Storefront > Navigation. Null keeps the built-in links. */
  links: SiteNavLink[] | null;
  /** The published Header page (brand, buttons). Null keeps the built-in header. */
  header: MkHeaderProps | null;
  /** The announcement bar, drawn on the server. */
  announcement: ReactNode;
  /** The saved platform logo (Super Admin > Branding), or null for the built-in mark. */
  brandLogo: BrandLogoPair | null;
}

export const SiteNavContext = createContext<SiteNav | null>(null);

export function SiteNavProvider({ links, header = null, announcement = null, brandLogo = null, children }: { links: SiteNavLink[] | null; header?: MkHeaderProps | null; announcement?: ReactNode; brandLogo?: BrandLogoPair | null; children: ReactNode }) {
  return <SiteNavContext.Provider value={{ links, header, announcement, brandLogo }}>{children}</SiteNavContext.Provider>;
}
