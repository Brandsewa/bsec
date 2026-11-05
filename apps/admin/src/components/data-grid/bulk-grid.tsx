import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Columns3, Search } from "lucide-react";
import { Button, Checkbox, MultiSelect, Popover, PopoverContent, PopoverTrigger, SimpleSelect, cn } from "@bs/ui";

/**
 * Dense spreadsheet-style grid for the bulk editors (docs/BULK-EDITOR-PLAN.md). Unlike `EditableGrid` (State Pricing,
 * one editable level), parent rows and child rows both carry editable cells, so each column renders its own cell and
 * the cell components below handle dirty marking, errors and keyboard movement. The grid owns no data.
 */
export interface BulkRow {
  id: string;
  /** Child rows (variants) sit under their parent and can be collapsed. */
  parentId?: string | undefined;
  /** Parent row with children: shows an expander in the first column. */
  childCount?: number | undefined;
}

export interface BulkColumn<R extends BulkRow> {
  id: string;
  header: string;
  /** Group heading in the Columns menu. */
  group: string;
  /** Pixel width. */
  width: number;
  align?: "left" | "right";
  /** Hidden until switched on in the Columns menu. */
  defaultHidden?: boolean;
  /** Always shown (the first column). */
  locked?: boolean;
  cell: (row: R) => ReactNode;
}

const cellBase =
  "h-7 w-full rounded-sm border border-transparent bg-transparent px-1.5 text-xs outline-none hover:border-border focus:border-ring focus:bg-background focus:ring-1 focus:ring-ring";

function dirtyCls(dirty?: boolean, error?: string | undefined) {
  return cn(dirty && "bg-amber-500/10", error && "border-destructive text-destructive");
}

export function TextCell({
  col,
  row,
  value,
  onChange,
  dirty,
  error,
  align = "left",
  placeholder,
  mono,
}: {
  col: string;
  row: string;
  value: string;
  onChange: (v: string) => void;
  dirty?: boolean;
  error?: string | undefined;
  align?: "left" | "right";
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      data-gc={col}
      data-gr={row}
      aria-label={`${col} for ${row}`}
      aria-invalid={error ? true : undefined}
      title={error}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      className={cn(cellBase, align === "right" && "text-right tabular-nums", mono && "font-mono", dirtyCls(dirty, error))}
    />
  );
}

export function SelectCell({
  value,
  onChange,
  options,
  dirty,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  dirty?: boolean;
  placeholder?: string;
  label: string;
}) {
  return (
    <SimpleSelect
      ariaLabel={label}
      value={value}
      onChange={onChange}
      options={options}
      {...(placeholder ? { placeholder } : {})}
      className={cn("h-7 w-full border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-border", dirty && "bg-amber-500/10")}
    />
  );
}

export function CheckCell({ checked, onChange, dirty, label }: { checked: boolean; onChange: (v: boolean) => void; dirty?: boolean; label: string }) {
  return (
    <div className={cn("flex h-7 items-center justify-center rounded-sm", dirty && "bg-amber-500/10")}>
      <Checkbox aria-label={label} checked={checked} onCheckedChange={(c) => onChange(Boolean(c))} />
    </div>
  );
}

export function MultiCell({
  options,
  value,
  onChange,
  dirty,
  placeholder,
}: {
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (v: string[]) => void;
  dirty?: boolean;
  placeholder?: string;
}) {
  return (
    <MultiSelect
      options={options}
      value={value}
      onChange={onChange}
      maxDisplay={1}
      {...(placeholder ? { placeholder } : {})}
      className={cn("min-h-7 border-transparent hover:border-border", dirty && "bg-amber-500/10")}
    />
  );
}

/** A cell that shows a one-line summary and opens a popover for richer editing (description, media). */
export function PopoverCell({
  summary,
  title,
  dirty,
  children,
  wide,
}: {
  summary: ReactNode;
  title: string;
  dirty?: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(cellBase, "flex items-center gap-1 text-left", dirty && "bg-amber-500/10")}
        aria-label={title}
      >
        <span className="min-w-0 flex-1 truncate">{summary}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("grid gap-3 p-4", wide ? "w-[560px] max-w-[92vw]" : "w-96 max-w-[92vw]")}>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export const emptyDash = <span className="text-muted-foreground/60">—</span>;

/** The "Columns" menu: search, grouped checkboxes. */
export function GridColumnsMenu<R extends BulkRow>({
  columns,
  isVisible,
  onToggle,
  onReset,
}: {
  columns: BulkColumn<R>[];
  isVisible: (id: string) => boolean;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const m = new Map<string, BulkColumn<R>[]>();
    for (const c of columns) {
      if (q && !c.header.toLowerCase().includes(q.toLowerCase())) continue;
      m.set(c.group, [...(m.get(c.group) ?? []), c]);
    }
    return [...m.entries()];
  }, [columns, q]);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3 className="mr-1.5 size-3.5" aria-hidden />
        Columns
      </PopoverTrigger>
      <PopoverContent align="end" className="grid max-h-[70vh] w-64 gap-2 overflow-y-auto p-3">
        <div className="relative">
          <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" aria-hidden />
          <input
            aria-label="Search fields"
            placeholder="Search fields"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background pr-2 pl-7 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {groups.map(([g, cols]) => (
          <div key={g} className="grid gap-1">
            <p className="pt-1 text-xs font-semibold text-foreground">{g}</p>
            {cols.map((c) => (
              <label key={c.id} className={cn("flex items-center gap-2 py-0.5 text-xs", c.locked ? "text-muted-foreground" : "cursor-pointer text-foreground")}>
                <Checkbox checked={c.locked ? true : isVisible(c.id)} disabled={c.locked} onCheckedChange={() => onToggle(c.id)} />
                {c.header}
              </label>
            ))}
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset columns
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function BulkGrid<R extends BulkRow>({
  columns,
  rows,
  empty,
  collapsed,
  onToggleCollapsed,
  className,
}: {
  columns: BulkColumn<R>[];
  rows: R[];
  empty: ReactNode;
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const visibleRows = rows.filter((r) => !r.parentId || !collapsed.has(r.parentId));

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (t.tagName !== "INPUT") return;
    const input = t as HTMLInputElement;
    const col = input.dataset["gc"];
    const rowId = input.dataset["gr"];
    if (!col || !rowId) return;
    const move = (dr: number) => {
      const same = [...(root.current?.querySelectorAll<HTMLInputElement>(`input[data-gc="${col}"]`) ?? [])];
      const i = same.findIndex((el) => el.dataset["gr"] === rowId);
      const next = same[i + dr];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    };
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) move(1);
    else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) move(-1);
  }

  if (rows.length === 0) return <div className={className}>{empty}</div>;

  return (
    <div ref={root} onKeyDown={onKeyDown} className={cn("overflow-auto rounded-lg border border-border bg-card", className)}>
      <table className="border-collapse text-xs" style={{ minWidth: "max-content" }}>
        <thead className="sticky top-0 z-20 bg-muted text-xs font-medium text-foreground">
          <tr>
            {columns.map((c, i) => (
              <th
                key={c.id}
                scope="col"
                style={{ width: c.width, minWidth: c.width, maxWidth: c.width }}
                className={cn(
                  "h-8 border-r border-b border-border px-2 text-left font-medium whitespace-nowrap last:border-r-0",
                  c.align === "right" && "text-right",
                  i === 0 && "sticky left-0 z-30 bg-muted",
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => (
            <tr key={r.id} className={cn("border-b border-border/60", r.parentId ? "bg-muted/20" : "bg-card")}>
              {columns.map((c, i) => (
                <td
                  key={c.id}
                  style={{ width: c.width, minWidth: c.width, maxWidth: c.width }}
                  className={cn("border-r border-border/60 px-0.5 py-0.5 align-middle last:border-r-0", i === 0 && "sticky left-0 z-10", i === 0 && (r.parentId ? "bg-muted" : "bg-card"))}
                >
                  {i === 0 ? (
                    <div className={cn("flex items-center gap-1", r.parentId && "pl-6")}>
                      {r.childCount ? (
                        <button
                          type="button"
                          aria-label={collapsed.has(r.id) ? "Show variants" : "Hide variants"}
                          aria-expanded={!collapsed.has(r.id)}
                          onClick={() => onToggleCollapsed(r.id)}
                          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
                        >
                          {collapsed.has(r.id) ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
                        </button>
                      ) : null}
                      <div className="min-w-0 flex-1">{c.cell(r)}</div>
                    </div>
                  ) : (
                    c.cell(r)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
