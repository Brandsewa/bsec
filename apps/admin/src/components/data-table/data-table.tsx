import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@bs/ui";
import { Checkbox } from "@bs/ui";
import { Skeleton } from "@bs/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@bs/ui";
import { cn } from "@/lib/utils";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Extra classes for both the header and the cells (widths, alignment). */
  className?: string;
  /** Server sort keys this column switches between. Omit for non-sortable columns. */
  sort?: { asc: string; desc: string };
  /** Listed in the Columns menu so the user can hide it. */
  optional?: boolean;
  defaultHidden?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  isLoading?: boolean;
  /** Refetching (new page/filter) while old rows are still on screen. */
  isFetching?: boolean;
  error?: { message: string; onRetry: () => void } | null;
  empty: ReactNode;
  /** Selected rows by id. Omit to hide the checkbox column. */
  selectedIds?: ReadonlySet<string>;
  onToggleRow?: (row: T, selected: boolean) => void;
  onTogglePage?: (rows: T[], selected: boolean) => void;
  sort?: string;
  onSortChange?: (sort: string) => void;
  onRowClick?: (row: T) => void;
  /** Trailing per-row actions (e.g. a "⋯" menu). */
  rowActions?: (row: T) => ReactNode;
  /** Compact card shown instead of table rows below the md breakpoint. */
  renderCard?: (row: T, ctx: { selected: boolean; toggle: () => void }) => ReactNode;
  /** Rows shown while loading. */
  skeletonRows?: number;
  /** Max height of the scroll area, so the header can stay pinned. */
  maxHeightClass?: string;
}

/** Stop a click inside a control (checkbox, menu) from also opening the row. */
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" | null }) {
  if (!active || !dir) return <ArrowUpDown className="size-3 opacity-40" aria-hidden />;
  return dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />;
}

/**
 * Dense, server-driven table: optional row selection, sortable headers, sticky header, clickable rows,
 * a per-row actions slot, and a card layout on small screens. It holds no data state of its own.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  isLoading,
  isFetching,
  error,
  empty,
  selectedIds,
  onToggleRow,
  onTogglePage,
  sort,
  onSortChange,
  onRowClick,
  rowActions,
  renderCard,
  skeletonRows = 8,
  maxHeightClass = "max-h-[calc(100dvh-18rem)]",
}: DataTableProps<T>) {
  const ids = selectedIds;
  const toggleRow = onToggleRow;
  const selectable = Boolean(ids && toggleRow);
  const selectedOnPage = ids ? rows.filter((r) => ids.has(getRowId(r))).length : 0;
  const allOnPage = rows.length > 0 && selectedOnPage === rows.length;
  const someOnPage = selectedOnPage > 0 && !allOnPage;
  const colCount = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-2 rounded-lg border border-border bg-background px-4 py-12 text-center">
        <AlertTriangle className="size-5 text-destructive" aria-hidden />
        <p className="text-sm font-medium text-foreground">Could not load this table</p>
        <p className="text-muted-foreground">{error.message}</p>
        <Button variant="outline" size="sm" onClick={error.onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  function headerFor(col: Column<T>) {
    const keys = col.sort;
    if (!keys || !onSortChange) return col.header;
    const dir = sort === keys.asc ? "asc" : sort === keys.desc ? "desc" : null;
    return (
      <button
        type="button"
        className="-mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        onClick={() => onSortChange(dir === "desc" ? keys.asc : keys.desc)}
      >
        {col.header}
        <SortIcon active={dir !== null} dir={dir} />
      </button>
    );
  }

  const stickyHead = "sticky top-0 z-10 bg-muted text-foreground-lighter shadow-[inset_0_-1px_0_var(--border-soft)]";

  return (
    <div className={cn("rounded-lg border border-border-soft bg-card shadow-xs", isFetching && !isLoading && "transition-opacity")} aria-busy={isFetching || undefined}>
      {/* Table: tablet and up */}
      <div className={renderCard ? "hidden md:block" : undefined}>
        <Table containerClassName={cn("overflow-y-auto", maxHeightClass, isFetching && !isLoading && "opacity-70")}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {selectable ? (
                <TableHead className={cn(stickyHead, "w-8 pr-0")}>
                  <Checkbox
                    aria-label="Select all rows on this page"
                    checked={allOnPage}
                    indeterminate={someOnPage}
                    disabled={rows.length === 0}
                    onCheckedChange={(c) => onTogglePage?.(rows, c)}
                  />
                </TableHead>
              ) : null}
              {columns.map((col) => (
                <TableHead
                  key={col.id}
                  className={cn(stickyHead, col.className)}
                  aria-sort={
                    col.sort && sort === col.sort.asc ? "ascending" : col.sort && sort === col.sort.desc ? "descending" : undefined
                  }
                >
                  {headerFor(col)}
                </TableHead>
              ))}
              {rowActions ? <TableHead className={cn(stickyHead, "w-10")}><span className="sr-only">Actions</span></TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: skeletonRows }, (_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell colSpan={colCount}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="h-40 text-center whitespace-normal">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const id = getRowId(row);
                const selected = Boolean(ids?.has(id));
                return (
                  <TableRow
                    key={id}
                    data-state={selected ? "selected" : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    className={onRowClick ? "cursor-pointer" : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                              e.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                  >
                    {selectable ? (
                      <TableCell className="w-8 pr-0" onClick={stop}>
                        <Checkbox
                          aria-label={`Select row ${id}`}
                          checked={selected}
                          onCheckedChange={(c) => toggleRow?.(row, c)}
                        />
                      </TableCell>
                    ) : null}
                    {columns.map((col) => (
                      <TableCell key={col.id} className={col.className}>
                        {col.cell(row)}
                      </TableCell>
                    ))}
                    {rowActions ? (
                      <TableCell className="w-10 text-right" onClick={stop}>
                        {rowActions(row)}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Cards: phones */}
      {renderCard ? (
        <div className="divide-y divide-border md:hidden">
          {isLoading ? (
            Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="p-3">
                <Skeleton className="h-14 w-full" />
              </div>
            ))
          ) : rows.length === 0 ? (
            <div className="px-4 py-10 text-center">{empty}</div>
          ) : (
            rows.map((row) => {
              const id = getRowId(row);
              const selected = Boolean(ids?.has(id));
              return (
                <div
                  key={id}
                  data-state={selected ? "selected" : undefined}
                  className="relative data-[state=selected]:bg-muted"
                >
                  {renderCard(row, { selected, toggle: () => onToggleRow?.(row, !selected) })}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
