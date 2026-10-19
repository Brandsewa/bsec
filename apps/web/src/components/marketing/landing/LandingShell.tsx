"use client";

import { useRef, type PointerEvent, type ReactNode } from "react";
import { fontSerifDisplay } from "@/lib/fonts.ts";
import { useRevealMotion } from "./motion.ts";
import "./landing.css";

/** Root of the marketing page: scopes the `.lp` styles, loads the display serif, arms the scroll reveals and the card spotlight. */
export function LandingShell({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useRevealMotion(rootRef, { item: ".rv", armedClass: "armed" });

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".spot");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  return (
    <div ref={rootRef} className={`lp ${fontSerifDisplay.variable}`} id="top" onPointerMove={onPointerMove}>
      {children}
    </div>
  );
}
