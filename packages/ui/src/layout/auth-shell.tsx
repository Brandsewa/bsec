"use client";

import * as React from "react";
import { ThemeToggle } from "../theme/index.ts";
import { Card } from "../components/ui/card.tsx";
import { cn } from "../lib/cn.ts";

export interface AuthShellProps {
  brand: {
    logo?: React.ReactNode;
    name: string;
  };
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  variant?: "platform" | "store";
  aside?: React.ReactNode;
  className?: string;
}

export function AuthShell({
  brand,
  title,
  description,
  children,
  footer,
  _variant = "platform",
  aside,
  className,
}: AuthShellProps & { _variant?: "platform" | "store" }) {
  return (
    <div className={cn("min-h-screen w-full flex bg-[var(--background)] text-[var(--foreground)] relative", className)}>
      {/* Top right ThemeToggle */}
      <div className="absolute top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      <div className="flex-1 flex flex-col justify-center items-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-[400px] space-y-6">
          {/* Brand header */}
          <div className="flex flex-col items-center text-center space-y-2">
            {brand.logo ? (
              <div className="h-10 w-10 flex items-center justify-center">
                {brand.logo}
              </div>
            ) : null}
            <div className="text-xs font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
              {brand.name}
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
              {title}
            </h1>
            {description && (
              <p className="text-xs text-[var(--muted-foreground)] text-balance">
                {description}
              </p>
            )}
          </div>

          {/* Form container */}
          <Card className="p-6 border border-[var(--border)] shadow-xs rounded-[var(--radius)] bg-[var(--card)]">
            {children}
          </Card>

          {/* Optional Footer */}
          {footer && (
            <div className="text-center text-xs text-[var(--muted-foreground)]">
              {footer}
            </div>
          )}
        </div>
      </div>

      {/* Optional Aside Desktop split panel */}
      {aside && (
        <div className="hidden lg:flex flex-1 relative bg-[var(--muted)] border-l border-[var(--border)] items-center justify-center p-12 overflow-hidden">
          {aside}
        </div>
      )}
    </div>
  );
}
