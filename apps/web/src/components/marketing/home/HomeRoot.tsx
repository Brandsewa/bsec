"use client";

import { useRef, type ReactNode } from "react";
import { useRevealMotion } from "./motion.ts";
import "./home.css";

/** Root of every platform marketing page: scopes the `.mk` styles and arms the scroll reveals. <html data-theme> sets the theme. */
export function HomeRoot({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useRevealMotion(rootRef, { item: ".rv", armedClass: "armed" });
  return (
    <div ref={rootRef} className="mk" id="top">
      {children}
    </div>
  );
}
