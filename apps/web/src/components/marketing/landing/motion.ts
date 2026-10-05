"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Arms the section reveals after mount. Content is visible by default (server render and no-JS); once armed,
 * elements still below the fold are hidden until they scroll into view and are then "printed in".
 */
export function useRevealMotion(
  rootRef: RefObject<HTMLElement | null>,
  { item = ".bz-rv", armedClass = "bz-armed" }: { item?: string; armedClass?: string } = {},
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;
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
    // Anything already on screen is revealed in the same frame the cloth is armed, so nothing flashes.
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

/**
 * A critically-damped-ish spring toward `target`: numbers settle with a small overshoot instead of snapping,
 * so a live counter feels like an instrument. Reduced motion jumps straight to the value.
 */
export function useSpringNumber(target: number, { stiffness = 120, damping = 15 } = {}): number {
  const [value, setValue] = useState(target);
  const state = useRef({ x: target, v: 0, raf: 0 });

  useEffect(() => {
    const s = state.current;
    if (prefersReducedMotion()) {
      s.x = target;
      s.v = 0;
      const t = window.setTimeout(() => setValue(target), 0);
      return () => window.clearTimeout(t);
    }
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const force = -stiffness * (s.x - target) - damping * s.v;
      s.v += force * dt;
      s.x += s.v * dt;
      setValue(s.x);
      if (Math.abs(s.x - target) < 0.4 && Math.abs(s.v) < 0.4) {
        s.x = target;
        s.v = 0;
        setValue(target);
        return;
      }
      s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(s.raf);
  }, [target, stiffness, damping]);

  return value;
}
