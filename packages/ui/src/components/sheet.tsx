import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";
import { DialogOverlay } from "./dialog.tsx";

export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;

const sides = {
  right: "inset-y-0 right-0 h-full w-full max-w-md border-l",
  left: "inset-y-0 left-0 h-full w-full max-w-xs border-r",
  bottom: "inset-x-0 bottom-0 max-h-[85vh] border-t rounded-t-lg",
} as const;

export function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: ComponentProps<typeof D.Content> & { side?: keyof typeof sides }) {
  return (
    <D.Portal>
      <DialogOverlay />
      <D.Content
        className={cn("fixed z-50 flex flex-col gap-4 overflow-y-auto border-border bg-background text-foreground p-6 shadow-xl", sides[side], className)}
        {...props}
      >
        {children}
        <D.Close className="absolute right-4 top-4 rounded-sm text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof D.Title>) {
  return <D.Title className={cn("text-base font-semibold", className)} {...props} />;
}
export function SheetDescription({ className, ...props }: ComponentProps<typeof D.Description>) {
  return <D.Description className={cn("text-sm text-foreground-2", className)} {...props} />;
}

