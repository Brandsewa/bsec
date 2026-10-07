import { ChevronRight } from "lucide-react";
import { Suspense, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { UiLink } from "../lib/link.tsx";

/**
 * Every admin route is built from these five pieces (PLAN §12):
 * PageContainer > PageBreadcrumbs > (PageNav) > PageHeader > PageSection*.
 */
const widths = {
  small: "max-w-3xl", // settings, forms
  default: "max-w-6xl", // lists, details
  full: "max-w-none", // dense tables, editors
} as const;

export function PageContainer({
  size = "default",
  className,
  ...props
}: ComponentProps<"div"> & { size?: keyof typeof widths }) {
  // grid-cols-1 gives the single column minmax(0, 1fr). Without it the implicit column is `auto`, which grows to
  // the widest unshrinkable child (a row of tabs, a toolbar) and pushes the whole page past a phone's width.
  return <div className={cn("mx-auto grid w-full grid-cols-1 gap-6 px-4 py-6 md:px-8", widths[size], className)} {...props} />;
}

export interface Crumb {
  label: string;
  href?: string;
}

/** First row of every page. `actions` sit here for parent pages that have a sub-nav. */
export function PageBreadcrumbs({ items, actions }: { items: Crumb[]; actions?: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          {items.map((c, i) => {
            const last = i === items.length - 1;
            return (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {c.href && !last ? (
                  <UiLink href={c.href} className="hover:text-foreground">
                    {c.label}
                  </UiLink>
                ) : (
                  <span className={cn(last && "text-foreground")} aria-current={last ? "page" : undefined}>
                    {c.label}
                  </span>
                )}
                {last ? null : <ChevronRight className="size-3.5" aria-hidden />}
              </li>
            );
          })}
        </ol>
      </nav>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Title + optional meta; `aside` holds actions on detail pages. */
export function PageHeader({
  title,
  description,
  meta,
  aside,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="text-sm text-foreground-2">{description}</p> : null}
        {meta ? <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">{meta}</div> : null}
      </div>
      {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
    </header>
  );
}

/**
 * Each section owns its Suspense boundary and matching skeleton, so one slow query
 * never blanks the whole page. The region is aria-busy while its fallback shows.
 */
export function PageSection({
  title,
  description,
  actions,
  fallback,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  fallback?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const body = fallback === undefined ? children : <Suspense fallback={<div aria-busy="true">{fallback}</div>}>{children}</Suspense>;
  return (
    <section className={cn("grid grid-cols-1 gap-3", className)}>
      {title || actions ? (
        <div className="flex items-end justify-between gap-4">
          <div className="grid gap-0.5">
            {title ? <h2 className="text-base font-medium text-foreground">{title}</h2> : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {body}
    </section>
  );
}
