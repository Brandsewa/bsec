"use client";

import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { type VariantProps } from "class-variance-authority";
import { buttonVariants } from "./button-variants.ts";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn.ts";

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

