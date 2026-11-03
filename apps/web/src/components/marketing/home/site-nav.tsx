"use client";

import { createContext, type ReactNode } from "react";
import type { MkHeaderProps } from "@bs/blocks";

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
}

export const SiteNavContext = createContext<SiteNav | null>(null);

export function SiteNavProvider({ links, header = null, announcement = null, children }: { links: SiteNavLink[] | null; header?: MkHeaderProps | null; announcement?: ReactNode; children: ReactNode }) {
  return <SiteNavContext.Provider value={{ links, header, announcement }}>{children}</SiteNavContext.Provider>;
}
