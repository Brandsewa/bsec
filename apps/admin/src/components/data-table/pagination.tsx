import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "../simple-select.tsx";

export const PAGE_SIZES = [25, 50, 100] as const;

/** Range + total, rows-per-page, and previous/next. `page` is 1-based. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  disabled,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  disabled?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-muted-foreground">
      <p aria-live="polite">
        {total === 0 ? "No results" : (
          <>
            <span className="font-medium text-foreground">{from}–{to}</span> of {total.toLocaleString("en-IN")}
          </>
        )}
      </p>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline">Rows per page</span>
          <SimpleSelect
            ariaLabel="Rows per page"
            className="w-16"
            value={String(pageSize)}
            onChange={(v) => onPageSizeChange(Number(v))}
            options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
          />
        </div>
        <span className="hidden sm:inline">
          Page {page} of {pages}
        </span>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" aria-label="Previous page" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" aria-label="Next page" disabled={disabled || page >= pages} onClick={() => onPageChange(page + 1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
