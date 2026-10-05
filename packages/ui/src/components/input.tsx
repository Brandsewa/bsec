import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-border-control bg-control px-3 text-sm text-foreground placeholder:text-foreground-muted max-md:h-touch",
        "focus-visible:border-primary-bright disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

