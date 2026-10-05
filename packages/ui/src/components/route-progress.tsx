"use client";

import * as React from "react";
import { cn } from "../lib/cn.ts";

export interface RouteProgressProps {
  isNavigating: boolean;
  className?: string;
}

export function RouteProgress({ isNavigating, className }: RouteProgressProps) {
  if (!isNavigating) return null;

  return (
    <div
      role="progressbar"
      aria-label="Page loading"
      className={cn("fixed top-0 left-0 right-0 z-50 h-[2px] bg-transparent overflow-hidden", className)}
    >
      <div className="h-full bg-[var(--brand)] animate-pulse w-full origin-left" />
    </div>
  );
}
