import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

/** Dialog = short, blocking decisions. Longer edits use Sheet (Supabase modality pattern). */
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogOverlay({ className, ...props }: ComponentProps<typeof D.Overlay>) {
  return <D.Overlay className={cn("fixed inset-0 z-50 bg-black/40", className)} {...props} />;
}

export function DialogContent({ className, children, ...props }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <DialogOverlay />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border-strong bg-overlay p-6 shadow-lg",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close className="absolute right-4 top-4 rounded-sm text-foreground-lighter hover:text-foreground" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid gap-1.5", className)} {...props} />;
}
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}
export function DialogTitle({ className, ...props }: ComponentProps<typeof D.Title>) {
  return <D.Title className={cn("text-base font-semibold", className)} {...props} />;
}
export function DialogDescription({ className, ...props }: ComponentProps<typeof D.Description>) {
  return <D.Description className={cn("text-sm text-foreground-light", className)} {...props} />;
}
