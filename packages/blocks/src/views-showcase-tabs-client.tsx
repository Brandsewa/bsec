"use client";
/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useRef, type ReactNode } from "react";

// Structural types: this file is also type-checked by packages without the DOM lib.
interface El {
  closest(selector: string): El | null;
  setAttribute(name: string, value: string): void;
  toggleAttribute(name: string, force: boolean): void;
  querySelectorAll(selector: string): ArrayLike<El>;
  tabIndex: number;
}

/**
 * Tab switching for the Product showcase where the storefront's own behaviour is not mounted (the theme editor's preview).
 * The storefront uses ProductShowcaseClient; without a host the tab buttons were plain markup and did nothing, so a
 * merchant could not see their second tab. Event delegation on one wrapper, no state, so the server markup stays as is.
 */
export function ShowcaseTabsPreview({ children }: { children: ReactNode }) {
  const root = useRef<unknown>(null);
  return (
    <div
      ref={root as never}
      style={{ display: "contents" }}
      onClick={(e) => {
        const host = root.current as El | null;
        const tab = (e.target as unknown as El).closest("[data-psc-tab]");
        if (!host || !tab) return;
        const tabs = Array.from(host.querySelectorAll("[data-psc-tab]"));
        const panels = Array.from(host.querySelectorAll("[data-psc-panel]"));
        const index = tabs.indexOf(tab);
        if (index < 0) return;
        tabs.forEach((t, i) => {
          t.setAttribute("aria-selected", String(i === index));
          t.tabIndex = i === index ? 0 : -1;
        });
        panels.forEach((p, i) => p.toggleAttribute("hidden", i !== index));
      }}
    >
      {children}
    </div>
  );
}
