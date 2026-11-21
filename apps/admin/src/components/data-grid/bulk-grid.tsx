import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
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

// ---------------------------------------------------------------------------------------------------------------
// Column layout: widths and order, remembered per grid in this browser
// ---------------------------------------------------------------------------------------------------------------

interface StoredLayout {
  widths: Record<string, number>;
  order: string[];
}
const MIN_COL = 60;
const MAX_COL = 800;

function readLayout(storageKey: string): StoredLayout {
  try {
    const raw = localStorage.getItem(storageKey);
    const v = raw ? (JSON.parse(raw) as Partial<StoredLayout>) : {};
    return { widths: v.widths && typeof v.widths === "object" ? v.widths : {}, order: Array.isArray(v.order) ? v.order.filter((x): x is string => typeof x === "string") : [] };
  } catch {
    return { widths: {}, order: [] };
  }
}

export interface GridLayout {
  /** Applies the saved widths and order to the visible columns. The `locked` column always stays first. */
  arrange: <R extends BulkRow>(cols: BulkColumn<R>[]) => BulkColumn<R>[];
  setWidth: (id: string, width: number) => void;
  /** Moves column `id` to where column `beforeId` is, within `ids` (the movable columns, in their current order). */
  move: (ids: string[], id: string, beforeId: string) => void;
  reset: () => void;
}

export function useGridLayout(key: string): GridLayout {
  const storageKey = `bulk-grid-layout:${key}`;
  const [layout, setLayout] = useState<StoredLayout>(() => readLayout(storageKey));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      /* private window or blocked storage: the layout just is not remembered */
    }
  }, [layout, storageKey]);

  const arrange = useCallback(
    <R extends BulkRow>(cols: BulkColumn<R>[]) => {
      const rank = (c: BulkColumn<R>, i: number) => {
        const at = layout.order.indexOf(c.id);
        return at === -1 ? layout.order.length + i : at;
      };
      const locked = cols.filter((c) => c.locked);
      const rest = cols
        .map((c, i) => ({ c, r: rank(c, i) }))
        .filter((x) => !x.c.locked)
        .sort((a, b) => a.r - b.r)
        .map((x) => x.c);
      return [...locked, ...rest].map((c) => {
        const w = layout.widths[c.id];
        return w ? { ...c, width: w } : c;
      });
    },
    [layout],
  );

  return useMemo(
    () => ({
      arrange,
      setWidth: (id, width) => setLayout((l) => ({ ...l, widths: { ...l.widths, [id]: Math.min(MAX_COL, Math.max(MIN_COL, Math.round(width))) } })),
      move: (ids, id, beforeId) => {
        if (id === beforeId || !ids.includes(id) || !ids.includes(beforeId)) return;
        const without = ids.filter((x) => x !== id);
        without.splice(without.indexOf(beforeId) + (ids.indexOf(id) < ids.indexOf(beforeId) ? 1 : 0), 0, id);
        setLayout((l) => ({ ...l, order: without }));
      },
      reset: () => setLayout({ widths: {}, order: [] }),
    }),
    [arrange],
  );
}

/** Text that opens a small box under the cell to edit: for titles, descriptions, SEO text and handles. */
function TextBoxCell({
  col,
  row,
  value,
  onChange,
  dirty,
  error,
  placeholder,
  mono,
  multiline,
}: {
  col: string;
  row: string;
  value: string;
  onChange: (v: string) => void;
  dirty?: boolean | undefined;
  error?: string | undefined;
  placeholder?: string | undefined;
  mono?: boolean | undefined;
  multiline?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-gc={col}
        data-gr={row}
        aria-label={`${col} for ${row}`}
        title={error ?? (value || undefined)}
        className={cn(cellBase, "flex items-center text-left", mono && "font-mono", dirtyCls(dirty, error))}
      >
        <span className="min-w-0 flex-1 truncate">{value || <span className="text-muted-foreground/60">{placeholder ?? "—"}</span>}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-80 max-w-[92vw] grid-cols-[minmax(0,1fr)] gap-1.5 p-2.5">
        <textarea
          autoFocus
          aria-label={`${col} for ${row}`}
          aria-invalid={error ? true : undefined}
          rows={multiline ? 4 : 2}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(multiline ? e.target.value : e.target.value.replace(/\s*[\r\n]+\s*/g, " "))}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (!multiline || !e.shiftKey)) {
              e.preventDefault();
              setOpen(false);
            }
          }}
          className={cn("w-full resize-none rounded-md border border-border bg-background p-2 text-xs outline-none focus:ring-1 focus:ring-ring", mono && "font-mono", error && "border-destructive")}
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <p className="text-[11px] text-muted-foreground">Enter to finish{multiline ? ", Shift+Enter for a new line" : ""}.</p>
      </PopoverContent>
    </Popover>
  );
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
  box,
  multiline,
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
  /** Edit in a small box under the cell instead of in the cell (text that needs room). */
  box?: boolean;
  /** With `box`: allow line breaks (Shift+Enter). */
  multiline?: boolean;
}) {
  if (box) return <TextBoxCell col={col} row={row} value={value} onChange={onChange} dirty={dirty} error={error} placeholder={placeholder} mono={mono} multiline={multiline} />;
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
      <PopoverContent align="start" className={cn("grid grid-cols-[minmax(0,1fr)] gap-3 p-4", wide ? "w-[560px] max-w-[92vw]" : "w-96 max-w-[92vw]")}>
        <p className="truncate text-sm font-semibold text-foreground" title={title}>
          {title}
        </p>
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
  layout,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  columns: BulkColumn<R>[];
  rows: R[];
  empty: ReactNode;
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
  className?: string;
  /** Column widths and order (from `useGridLayout`). Without it columns are fixed. */
  layout?: GridLayout;
  /** More rows exist than are shown: `onLoadMore` fires when the bottom of the grid scrolls into view. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const visibleRows = rows.filter((r) => !r.parentId || !collapsed.has(r.parentId));
  const movable = columns.filter((c) => !c.locked).map((c) => c.id);
  const totalWidth = columns.reduce((n, c) => n + c.width, 0);

  useEffect(() => {
    const el = sentinel.current;
    if (!hasMore || loadingMore || !onLoadMore || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore();
      },
      { root: root.current, rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // rows.length: after a page lands the observer is rebuilt, so a still-visible bottom loads the next page too.
  }, [hasMore, loadingMore, onLoadMore, rows.length]);

  function startResize(e: MouseEvent<HTMLElement>, col: BulkColumn<R>) {
    if (!layout) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = col.width;
    const onMove = (ev: globalThis.MouseEvent) => layout.setWidth(col.id, startW + ev.clientX - startX);
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    const isInput = t.tagName === "INPUT";
    // Box cells are buttons: Enter opens them, so only the arrows move between rows.
    const isBox = t.tagName === "BUTTON" && t.dataset["gc"] !== undefined;
    if (!isInput && !isBox) return;
    const col = t.dataset["gc"];
    const rowId = t.dataset["gr"];
    if (!col || !rowId) return;
    const move = (dr: number) => {
      const same = [...(root.current?.querySelectorAll<HTMLElement>(`[data-gc="${col}"]`) ?? [])];
      const i = same.findIndex((el) => el.dataset["gr"] === rowId);
      const next = same[i + dr];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    };
    if (e.key === "ArrowDown" || (isInput && e.key === "Enter" && !e.shiftKey)) move(1);
    else if (e.key === "ArrowUp" || (isInput && e.key === "Enter" && e.shiftKey)) move(-1);
  }

  if (rows.length === 0) return <div className={className}>{empty}</div>;

  return (
    <div ref={root} onKeyDown={onKeyDown} className={cn("overflow-auto rounded-lg border border-border bg-card", className)}>
      <table className="border-collapse text-xs" style={{ tableLayout: "fixed", width: totalWidth }}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.id} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-20 bg-muted text-xs font-medium text-foreground">
          <tr>
            {columns.map((c, i) => {
              const canMove = Boolean(layout) && !c.locked;
              return (
                <th
                  key={c.id}
                  scope="col"
                  draggable={canMove}
                  tabIndex={canMove ? 0 : undefined}
                  title={canMove ? "Drag to move this column. Drag its right edge to resize." : undefined}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", c.id);
                    setDragId(c.id);
                  }}
                  onDragOver={(e) => {
                    if (!dragId || c.locked) return;
                    e.preventDefault();
                    setOverId(c.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId && !c.locked) layout?.move(movable, dragId, c.id);
                    setDragId(null);
                    setOverId(null);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  onKeyDown={(e) => {
                    if (!canMove || !e.altKey) return;
                    const at = movable.indexOf(c.id);
                    const to = e.key === "ArrowLeft" ? movable[at - 1] : e.key === "ArrowRight" ? movable[at + 1] : undefined;
                    if (to) {
                      e.preventDefault();
                      layout?.move(movable, c.id, to);
                    }
                  }}
                  className={cn(
                    "relative h-8 overflow-hidden border-r border-b border-border px-2 text-left font-medium text-ellipsis whitespace-nowrap last:border-r-0",
                    c.align === "right" && "text-right",
                    i === 0 && "sticky left-0 z-30 bg-muted",
                    canMove && "cursor-grab active:cursor-grabbing",
                    dragId === c.id && "opacity-50",
                    overId === c.id && dragId !== c.id && "bg-primary/10",
                  )}
                >
                  {c.header}
                  {layout ? (
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${c.header}`}
                      draggable={false}
                      onMouseDown={(e) => startResize(e, c)}
                      className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                    />
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => (
            <tr key={r.id} className={cn("border-b border-border/60", r.parentId ? "bg-muted/20" : "bg-card")}>
              {columns.map((c, i) => (
                <td
                  key={c.id}
                  className={cn("overflow-hidden border-r border-border/60 px-0.5 py-0.5 align-middle last:border-r-0", i === 0 && "sticky left-0 z-10", i === 0 && (r.parentId ? "bg-muted" : "bg-card"))}
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
      <div ref={sentinel} className="h-px" aria-hidden />
      {hasMore ? (
        <p role="status" className="sticky left-0 w-fit px-3 py-2 text-xs text-muted-foreground">
          {loadingMore ? "Loading more…" : "Scroll to load more"}
        </p>
      ) : null}
    </div>
  );
}
