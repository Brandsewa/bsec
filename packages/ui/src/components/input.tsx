import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-muted px-3 text-sm text-foreground placeholder:text-faint-foreground max-md:h-touch",
        "focus-visible:border-brand disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

