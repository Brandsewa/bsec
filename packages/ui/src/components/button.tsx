import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary-solid text-primary-solid-foreground hover:bg-primary-solid/90",
        default: "border border-border-control bg-control text-foreground hover:bg-surface-200",
        ghost: "text-foreground-light hover:bg-surface-200 hover:text-foreground",
        destructive: "bg-destructive-solid text-destructive-foreground hover:bg-destructive-solid/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 max-md:h-touch",
        md: "h-9 px-4 max-md:h-touch",
        icon: "size-9 max-md:size-touch",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Saves show a spinner + disabled state, never a skeleton (PLAN §12). */
  loading?: boolean;
}

export function Button({ className, variant, size, asChild, loading, disabled, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </Comp>
  );
}
