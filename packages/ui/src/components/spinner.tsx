"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/cn.ts";

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
}

export function Spinner({ size = "md", className, ...props }: SpinnerProps) {
  const sizeClasses = {
    sm: "h-3.5 w-3.5",
    md: "h-5 w-5",
    lg: "h-7 w-7",
  };

  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("inline-flex items-center justify-center text-[var(--muted-foreground)]", className)}
      {...props}
    >
      <Loader2 className={cn("animate-spin", sizeClasses[size])} />
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export interface EmptyProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function Empty({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 text-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)]",
        className,
      )}
    >
      {Icon && (
        <div className="mb-3 rounded-full bg-[var(--muted)] p-3 text-[var(--muted-foreground)]">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="text-sm font-medium text-[var(--foreground)]">{title}</h3>
      {description && (
        <p className="mt-1 text-xs text-[var(--muted-foreground)] max-w-sm">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
