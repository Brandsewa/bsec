"use client";

import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn.ts";

export const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all outline-none select-none rounded-[var(--radius-button)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/90 shadow-xs",
        default: "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/90 shadow-xs",
        brand: "bg-[var(--brand)] text-[#0a0a0a] hover:bg-[var(--brand-deep)] shadow-xs font-semibold",
        secondary: "border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)] shadow-xs",
        outline: "border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)] shadow-xs",
        ghost: "text-[var(--foreground)] hover:bg-[var(--muted)]",
        destructive: "bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:bg-[var(--destructive)]/90 shadow-xs",
        link: "text-[var(--brand-ink)] underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-[13px] gap-1.5 [&_svg]:size-3.5",
        md: "h-10 px-5 text-[14px] gap-2 [&_svg]:size-4",
        default: "h-10 px-5 text-[14px] gap-2 [&_svg]:size-4",
        lg: "h-11 px-6 text-[15px] gap-2 [&_svg]:size-4",
        icon: "size-8 p-0 max-md:size-10",
        "icon-sm": "size-7 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonPrimitive.Props,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, asChild, render, children, ...props }, ref) => {
    const finalRender = asChild && React.isValidElement(children) ? children : render;
    return (
      <ButtonPrimitive
        ref={ref}
        data-slot="button"
        render={finalRender}
        disabled={disabled || loading}
        aria-busy={loading ? "true" : undefined}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {loading && <Loader2 className="animate-spin text-current" />}
        {asChild && React.isValidElement(children) ? null : children}
      </ButtonPrimitive>
    );
  },
);
Button.displayName = "Button";

