import { Columns3, X } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Column } from "./data-table.tsx";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** Active filters as removable chips, with a single "Clear filters". Renders nothing when there are none. */
export function FilterChips({ chips, onClear }: { chips: FilterChip[]; onClear: () => void }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((c) => (
        <Badge key={c.key} variant="secondary" className="h-6 gap-1 pr-1 pl-2">
          {c.label}
          <button
            type="button"
            aria-label={`Remove filter: ${c.label}`}
            className="grid size-4 place-items-center rounded-full hover:bg-foreground/10"
            onClick={c.onRemove}
          >
            <X className="size-3" aria-hidden />
          </button>
        </Badge>
      ))}
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}

/** "Columns" menu listing the table's optional columns. */
export function ColumnsMenu<T>({
  columns,
  isVisible,
  onToggle,
  onReset,
}: {
  columns: Column<T>[];
  isVisible: (id: string) => boolean;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  const optional = columns.filter((c) => c.optional);
  if (optional.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3 className="mr-1.5 size-3.5" aria-hidden />
        Columns
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {optional.map((c) => (
          <DropdownMenuCheckboxItem key={c.id} checked={isVisible(c.id)} onCheckedChange={() => onToggle(c.id)}>
            {c.header}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onReset}>Reset columns</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Shown while rows are selected: count, the page's actions, and "select all results" when the selection
 * is only the current page. `children` are the action buttons.
 */
export function BulkBar({
  count,
  noun,
  total,
  allResults,
  pageFullySelected,
  onSelectAllResults,
  onClear,
  note,
  children,
}: {
  count: number;
  noun: string;
  total: number;
  allResults: boolean;
  pageFullySelected: boolean;
  onSelectAllResults: () => void;
  onClear: () => void;
  note?: string | undefined;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="grid gap-1 rounded-lg border border-border bg-muted px-3 py-2" role="region" aria-label="Bulk actions">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">
          {allResults ? `All ${total.toLocaleString("en-IN")} ${noun}s selected` : `${count} ${noun}${count === 1 ? "" : "s"} selected`}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">{children}</div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
          Clear selection
        </Button>
      </div>
      {!allResults && pageFullySelected && total > count ? (
        <p className="text-muted-foreground">
          This page is selected.{" "}
          <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={onSelectAllResults}>
            Select all {total.toLocaleString("en-IN")} {noun}s
          </button>
        </p>
      ) : null}
      {note ? <p className="text-muted-foreground">{note}</p> : null}
    </div>
  );
}
