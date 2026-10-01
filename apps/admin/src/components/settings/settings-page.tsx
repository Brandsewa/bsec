import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBlocker } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../confirm-dialog.tsx";

/** The element in the page header where a section's primary action (Save changes) is shown. */
const ActionsSlot = createContext<HTMLElement | null>(null);

/**
 * Consistent frame for one settings section: title and description on the left, primary actions on the right,
 * then the content in a single card whose parts are separated by dividers (no nested cards).
 * `width="wide"` lets editors such as Branding use the full content column.
 */
export function SettingsPageFrame({
  title,
  description,
  width = "narrow",
  children,
}: {
  title: string;
  description?: ReactNode;
  width?: "narrow" | "wide";
  children: ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <ActionsSlot.Provider value={slot}>
      <div className={cn("grid gap-3", width === "narrow" && "max-w-3xl")}>
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <div ref={setSlot} className="flex shrink-0 flex-wrap items-center gap-2 empty:hidden" />
        </header>
        <div className="rounded-lg border border-border bg-background">{children}</div>
      </div>
    </ActionsSlot.Provider>
  );
}

/**
 * Puts buttons into the page header from anywhere inside the frame, so a form deep in the tree can expose
 * its Save button next to the title (use `<Button type="submit" form="the-form-id">`).
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(ActionsSlot);
  return slot ? createPortal(children, slot) : null;
}

/** One group of related settings inside the frame's card. */
export function SettingsSection({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 border-t border-border p-3.5 first:border-t-0 md:p-4">
      {title || actions ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-foreground">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs/relaxed text-muted-foreground">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Warns before leaving a section (or the tab) with unsaved changes. Render the returned node anywhere in the
 * section. Switching sections with nothing changed is instant and never prompts.
 */
export function useUnsavedGuard(dirty: boolean): ReactNode {
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  return (
    <ConfirmDialog
      open={blocker.status === "blocked"}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
      title="Discard unsaved changes?"
      description="You have changes in this section that have not been saved."
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      destructive
      onConfirm={() => blocker.proceed?.()}
    />
  );
}
