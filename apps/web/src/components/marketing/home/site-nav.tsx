"use client";

import { createContext, type ReactNode } from "react";

export interface SiteNavLink {
  label: string;
  href: string;
}

/** Header links saved under Marketing > Navigation. Null keeps the built-in links. */
export const SiteNavContext = createContext<SiteNavLink[] | null>(null);

export function SiteNavProvider({ links, children }: { links: SiteNavLink[] | null; children: ReactNode }) {
  return <SiteNavContext.Provider value={links}>{children}</SiteNavContext.Provider>;
}
