"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { cn } from "../lib/cn.ts";

export interface InfoTipProps {
  children: React.ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}

export function InfoTip({ children, className, side = "top" }: InfoTipProps) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className={cn(
          "inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] rounded-sm",
          className,
        )}
        aria-label="Information"
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent
        side={side}
        className="max-w-xs p-3 text-xs text-[var(--foreground)] bg-[var(--popover)] border border-[var(--border)] shadow-md rounded-md leading-relaxed z-50"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
