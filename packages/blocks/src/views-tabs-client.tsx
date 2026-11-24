"use client";
/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useRef, type ReactNode } from "react";

// Structural types: this file is also type-checked by packages without the DOM lib.
interface El {
  closest(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El>;
  setAttribute(name: string, value: string): void;
  toggleAttribute(name: string, force?: boolean): void;
  hasAttribute(name: string): boolean;
  focus(): void;
  tabIndex: number;
}
interface KeyEvt {
  key: string;
  target: unknown;
  preventDefault(): void;
}

/**
 * Behaviour for the Tabs block: event delegation on one wrapper, no React state, so the server markup stays as it is.
 * A tab title selects that tab (one panel at a time). An accordion header toggles its row, closing the others when the
 * block is set to "one open at a time". Arrow keys, Home and End move between the tab titles.
 */
export function TabsBehavior({ children }: { children: ReactNode }) {
  const root = useRef<unknown>(null);

  const select = (host: El, index: number, focus = false) => {
    const tabs = Array.from(host.querySelectorAll("[data-tb-tab]"));
    const items = Array.from(host.querySelectorAll("[data-tb-item]"));
    tabs.forEach((t, i) => {
      t.setAttribute("aria-selected", String(i === index));
      t.tabIndex = i === index ? 0 : -1;
    });
    items.forEach((it, i) => it.toggleAttribute("data-current", i === index));
    if (focus) tabs[index]?.focus();
  };

  return (
    <div
      ref={root as never}
      style={{ display: "contents" }}
      onClick={(e) => {
        const host = root.current as El | null;
        const target = e.target as unknown as El;
        if (!host) return;
        const tab = target.closest("[data-tb-tab]");
        if (tab) {
          const index = Array.from(host.querySelectorAll("[data-tb-tab]")).indexOf(tab);
          if (index >= 0) select(host, index);
          return;
        }
        const acc = target.closest("[data-tb-acc]");
        const item = acc?.closest("[data-tb-item]");
        if (!acc || !item) return;
        const block = item.closest("[data-tb]");
        const items = Array.from(host.querySelectorAll("[data-tb-item]"));
        const opening = !item.hasAttribute("data-open");
        if (opening && block?.hasAttribute("data-tb-single")) {
          items.forEach((it) => {
            it.toggleAttribute("data-open", false);
            Array.from(it.querySelectorAll("[data-tb-acc]")).forEach((a) => a.setAttribute("aria-expanded", "false"));
          });
        }
        item.toggleAttribute("data-open", opening);
        acc.setAttribute("aria-expanded", String(opening));
        // Keep the tab state in step so resizing to a wide screen shows the row that was last touched.
        if (opening) select(host, items.indexOf(item));
      }}
      onKeyDown={(e) => {
        const host = root.current as El | null;
        const ev = e as unknown as KeyEvt;
        const tab = (ev.target as El).closest?.("[data-tb-tab]");
        if (!host || !tab) return;
        const tabs = Array.from(host.querySelectorAll("[data-tb-tab]"));
        const at = tabs.indexOf(tab);
        let next = -1;
        if (ev.key === "ArrowRight" || ev.key === "ArrowDown") next = (at + 1) % tabs.length;
        else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") next = (at - 1 + tabs.length) % tabs.length;
        else if (ev.key === "Home") next = 0;
        else if (ev.key === "End") next = tabs.length - 1;
        if (next < 0) return;
        ev.preventDefault();
        select(host, next, true);
      }}
    >
      {children}
    </div>
  );
}
