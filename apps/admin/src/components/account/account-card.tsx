import type { ReactNode } from "react";

/**
 * One card of the Account page. Unlike the settings card, the description sits under the title and the actions wrap onto
 * their own line on a phone, so nothing is pushed past the screen edge at 375 px.
 */
export function AccountCard({ title, description, actions, children }: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-background p-4 shadow-xs sm:p-5">
      {title || actions ? (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-60">
            {title ? <h2 className="text-sm font-semibold text-foreground">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs/relaxed text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}
