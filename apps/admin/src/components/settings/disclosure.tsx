import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A collapsible section: a header row (title, short summary, optional actions on the right) that toggles the body.
 * The actions sit beside the toggle button, not inside it, so buttons are never nested.
 */
export function Disclosure({
  title,
  summary,
  actions,
  defaultOpen = false,
  className,
  children,
}: {
  title: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">{title}</span>
          {summary ? <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{summary}</span> : null}
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div id={bodyId} hidden={!open} className="pt-3">
        {children}
      </div>
    </div>
  );
}
