import { ArrowUpDown, SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@bs/ui";
import { Input } from "@bs/ui";
import { RadioGroup, RadioGroupItem } from "@bs/ui";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@bs/ui";

export interface SortOption {
  id: string;
  label: string;
}

/**
 * The strip above every table.
 * Tablet and up: search, the page's filter controls and a trailing slot (usually the Columns menu), all inline.
 * Phones: search on its own row, then two buttons that open a Filters sidebar and a Sort sidebar.
 */
export function TableToolbar({
  searchLabel,
  searchPlaceholder,
  searchText,
  onSearchText,
  filters,
  activeFilterCount = 0,
  hasFilters = false,
  onClearFilters,
  resultCount,
  noun,
  sortOptions,
  sort,
  defaultSort,
  onSort,
  trailing,
}: {
  searchLabel: string;
  searchPlaceholder: string;
  searchText: string;
  onSearchText: (v: string) => void;
  /** Filter controls. Rendered inline on tablet+ and stacked inside the mobile Filters sidebar. */
  filters?: ReactNode;
  activeFilterCount?: number;
  hasFilters?: boolean;
  onClearFilters?: () => void;
  resultCount: number;
  /** Plural noun for the "Show N …" button, e.g. "orders". */
  noun: string;
  sortOptions?: ReadonlyArray<SortOption>;
  sort?: string;
  defaultSort?: string;
  onSort?: (id: string | undefined) => void;
  trailing?: ReactNode;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  return (
    <>
      <div className="grid gap-2 md:flex md:flex-wrap md:items-center">
        <Input
          type="search"
          aria-label={searchLabel}
          className="w-full md:max-w-64"
          value={searchText}
          onChange={(e) => onSearchText(e.target.value)}
          placeholder={searchPlaceholder}
        />
        <div className={`grid gap-2 md:hidden ${filters && sortOptions && sortOptions.length > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
          {filters ? (
            <Button variant="outline" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal className="mr-1.5" aria-hidden />
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </Button>
          ) : null}
          {sortOptions && sortOptions.length > 0 ? (
            <Button variant="outline" onClick={() => setSortOpen(true)}>
              <ArrowUpDown className="mr-1.5" aria-hidden />
              Sort
            </Button>
          ) : null}
        </div>
        <div className="hidden md:contents">
          {filters}
          {trailing ? <div className="ml-auto">{trailing}</div> : null}
        </div>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent className="w-full sm:max-w-sm">
          <SheetHeader className="border-b border-border">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Narrow down the list.</SheetDescription>
          </SheetHeader>
          <div className="grid content-start gap-3 overflow-y-auto p-4">{filters}</div>
          <SheetFooter className="border-t border-border">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={!hasFilters || !onClearFilters} onClick={onClearFilters}>
                Clear all
              </Button>
              <Button onClick={() => setFiltersOpen(false)}>
                Show {resultCount.toLocaleString("en-IN")} {noun}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {sortOptions && sortOptions.length > 0 && onSort ? (
        <Sheet open={sortOpen} onOpenChange={setSortOpen}>
          <SheetContent className="w-full sm:max-w-sm">
            <SheetHeader className="border-b border-border">
              <SheetTitle>Sort by</SheetTitle>
              <SheetDescription>Choose how the list is ordered.</SheetDescription>
            </SheetHeader>
            <RadioGroup
              className="gap-1 p-3"
              value={sort}
              onValueChange={(v) => {
                onSort(v === defaultSort ? undefined : v);
                setSortOpen(false);
              }}
            >
              {sortOptions.map((o) => (
                <label key={o.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2.5 text-sm hover:bg-muted">
                  <RadioGroupItem value={o.id} />
                  {o.label}
                </label>
              ))}
            </RadioGroup>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}
