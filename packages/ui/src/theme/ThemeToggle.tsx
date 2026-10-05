"use client";

import React from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "./ThemeProvider.tsx";
import { cn } from "../lib/cn.ts";

export interface ThemeToggleProps {
  className?: string;
  variant?: "segmented" | "menu";
}

export function ThemeToggle({ className, variant = "segmented" }: ThemeToggleProps) {
  const { preference, setPreference } = useTheme();

  if (variant === "menu") {
    return (
      <div className={cn("flex flex-col gap-1 p-1 text-xs", className)} role="radiogroup" aria-label="Theme mode">
        {(
          [
            { key: "light", label: "Light", icon: Sun },
            { key: "dark", label: "Dark", icon: Moon },
            { key: "system", label: "System", icon: Monitor },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={preference === key}
            onClick={() => setPreference(key)}
            className={cn(
              "flex items-center gap-2 rounded px-2 py-1.5 transition-colors text-left",
              preference === key
                ? "bg-[var(--muted)] text-[var(--foreground)] font-medium"
                : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme preference"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--card)] p-0.5 text-xs",
        className,
      )}
    >
      {(
        [
          { key: "light", label: "Light", icon: Sun },
          { key: "dark", label: "Dark", icon: Moon },
          { key: "system", label: "System", icon: Monitor },
        ] as const
      ).map(({ key, label, icon: Icon }) => {
        const isSelected = preference === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={label}
            title={label}
            onClick={() => setPreference(key)}
            className={cn(
              "inline-flex h-7 items-center justify-center rounded px-2 transition-all cursor-pointer",
              isSelected
                ? "bg-[var(--muted)] text-[var(--foreground)] shadow-xs font-medium"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="sr-only sm:not-sr-only sm:ml-1.5 text-[11px]">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
