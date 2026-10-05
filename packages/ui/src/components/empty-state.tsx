import type { ComponentType, ReactNode } from "react";

/** EmptyStatePresentational (Supabase fragment), in shop vocabulary. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border-strong bg-surface-75 px-6 py-12 text-center">
      {Icon ? <Icon className="size-8 text-foreground-muted" aria-hidden /> : null}
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="max-w-sm text-sm text-foreground-lighter">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

