import { cva } from "class-variance-authority";

/** The button look as a class string. A separate file without "use client" so server components can call it (the Button component itself is a client component). */
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
        link: "text-[var(--brand-ink)] underline-offset-4 hover:opacity-70 transition-opacity p-0 h-auto",
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
