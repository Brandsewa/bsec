import { useId } from "react";
import type { ReactNode } from "react";

/**
 * The "View all" button and its side drawer, done with the browser's own popover (no JavaScript shipped): the button opens it,
 * Escape, the Close button or a click outside close it. The coupon cards inside are passed in as children. Server component.
 */
export function CouponDrawer({ label, children }: { label: string; children: ReactNode }) {
  const id = `coupons-${useId().replace(/:/g, "")}`;
  return (
    <>
      <button type="button" popoverTarget={id} className="text-sm font-semibold text-foreground underline underline-offset-4">
        {label}
      </button>
      <aside
        id={id}
        popover="auto"
        aria-label="All coupons"
        className="bs-skin m-0 ml-auto h-dvh max-h-none w-full max-w-md border-0 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-base font-semibold">Available coupons</h3>
            <button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="Close" className="rounded-full px-2 py-1 text-xl leading-none hover:bg-muted">
              ×
            </button>
          </div>
          <div className="grid flex-1 content-start gap-3 overflow-y-auto p-4">{children}</div>
        </div>
      </aside>
    </>
  );
}
