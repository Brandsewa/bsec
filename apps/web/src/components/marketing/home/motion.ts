"use client";

import { useEffect, type RefObject } from "react";

/**
 * Arms the section reveals after mount. Content is visible by default (server render and no-JS); once armed,
 * elements still below the fold are hidden until they scroll into view.
 */
export function useRevealMotion(rootRef: RefObject<HTMLElement | null>, { item, armedClass }: { item: string; armedClass: string }): void {
  useEffect(() => {
    const root = rootRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!root || reduced || typeof IntersectionObserver === "undefined") return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>(item));
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0 },
    );
    // Anything already on screen is revealed in the same frame the page is armed, so nothing flashes.
    const vh = window.innerHeight;
    for (const el of targets) {
      if (el.getBoundingClientRect().top < vh * 0.92) el.classList.add("is-in");
      else io.observe(el);
    }
    root.classList.add(armedClass);
    return () => {
      io.disconnect();
      root.classList.remove(armedClass);
    };
  }, [rootRef, item, armedClass]);
}
