import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { Input } from "../components/input.tsx";
import { Button } from "../components/button.tsx";

export interface FilterBarProps {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  actions?: ReactNode;
  onReset?: () => void;
  hasActiveFilters?: boolean;
  className?: string;
}

/**
 * FilterBar (Supabase design pattern ported to shop admin).
 * Standard list header with search, filter popovers, reset button, and bulk/creation actions.
 */
export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = "Search...",
  filters,
  actions,
  onReset,
  hasActiveFilters,
  className,
}: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {onSearchChange !== undefined || search !== undefined ? (
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <Search
              className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint-foreground pointer-events-none"
              aria-hidden
            />
            <Input
              type="search"
              value={search ?? ""}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8 pr-7"
            />
            {search && onSearchChange ? (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-faint-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}

        {filters}

        {hasActiveFilters && onReset ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-xs text-faint-foreground hover:text-foreground"
          >
            Reset
          </Button>
        ) : null}
      </div>

      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
