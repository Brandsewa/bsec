"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";

export const SEARCH_OPEN_EVENT = "bs:open-search";

// The popup (and its quick-buy dialog) is fetched the first time someone opens search, not with every page.
const SearchModalPanel = dynamic(() => import("./SearchModalPanel.tsx").then((m) => m.SearchModalPanel), { ssr: false });

/**
 * Opens the search popup from the header's search icon (which still goes to /search without JavaScript) and from the
 * phone bottom bar ("bs:open-search"). Only this small listener is part of every page.
 */
export function SearchModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onEvent = () => setOpen(true);
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a");
      if (!link || link.getAttribute("href") !== "/search" || link.closest("[data-search-modal]")) return;
      // Capture phase: next/link's own handler (React, on the root) calls preventDefault first, which would
      // make this listener bail out on desktop, where the header icon is a next/link.
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    };
    window.addEventListener(SEARCH_OPEN_EVENT, onEvent);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener(SEARCH_OPEN_EVENT, onEvent);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return open ? <SearchModalPanel onClose={() => setOpen(false)} /> : null;
}
