import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@bs/ui";

/**
 * A compact spreadsheet-style grid for bulk editing (first used by State Pricing; built to be reused for the products
 * bulk editor). Why our own and not a grid library: AG Grid keeps row grouping and tree data in its paid edition,
 * Handsontable is not free for commercial use, and react-data-grid is still a beta for React 19. What we need is small:
 * nested rows, editable cells, keyboard movement, paste from Excel, and dirty marking. The data model stays outside:
 * the caller owns the edits and the grid only renders, moves focus and reports changes.
 *
 * Rows are a tree (a product with variants). A node with one child collapses into one editable row so single-variant
 * products need no click. A node with several children is a group row with an expander; its children are the editable rows.
 */
export interface GridNode<T> {
  id: string;
  data: T;
  children?: GridNode<T>[] | undefined;
}

export interface GridColumn<T> {
  id: string;
  header: ReactNode;
  /** CSS width, e.g. "9rem". */
  width: string;
  align?: "left" | "right";
  /** Read-only content. Receives the node; for a group row `isGroup` is true. */
  render?: (node: GridNode<T>, ctx: { isGroup: boolean; childCount: number }) => ReactNode;
  /** Set for an editable column. */
  edit?: {
    /** Current text of the cell and whether it differs from what is saved, or a message when it is invalid. */
    cell: (node: GridNode<T>) => { value: string; dirty: boolean; error?: string | undefined; placeholder?: string | undefined; readOnly?: boolean | undefined };
  };
}

export interface EditableGridProps<T> {
  columns: GridColumn<T>[];
  nodes: GridNode<T>[];
  /** Changing one cell. */
  onCellChange: (node: GridNode<T>, columnId: string, value: string) => void;
  /** A multi-cell paste (rows of cells, from Excel or Sheets), starting at the focused cell. */
  onPaste?: (start: { node: GridNode<T>; columnId: string }, matrix: string[][], rows: GridNode<T>[]) => void;
  /** Revert one cell (Escape). */
  onRevert?: (node: GridNode<T>, columnId: string) => void;
  /** Extra header cell at the end (for example "Add a state"). */
  trailingHeader?: ReactNode;
  /** Extra cell at the end of every editable row. */
  trailingCell?: (node: GridNode<T>) => ReactNode;
  expanded: ReadonlySet<string>;
  onToggleExpanded: (id: string) => void;
  /** Shown instead of rows when there are none. */
  empty: ReactNode;
  className?: string;
}

/** The rows a keyboard user moves between: editable leaves in display order. */
function visibleLeaves<T>(nodes: GridNode<T>[], expanded: ReadonlySet<string>): GridNode<T>[] {
  const out: GridNode<T>[] = [];
  for (const n of nodes) {
    const kids = n.children ?? [];
    if (kids.length <= 1) out.push(kids[0] ?? n);
    else if (expanded.has(n.id)) out.push(...kids);
  }
  return out;
}

export function EditableGrid<T>({ columns, nodes, onCellChange, onPaste, onRevert, trailingHeader, trailingCell, expanded, onToggleExpanded, empty, className }: EditableGridProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const leaves = useMemo(() => visibleLeaves(nodes, expanded), [nodes, expanded]);
  const leafIndexById = useMemo(() => new Map(leaves.map((l, i) => [l.id, i])), [leaves]);
  const editableIds = useMemo(() => columns.filter((c) => c.edit).map((c) => c.id), [columns]);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  function focusCell(rowIndex: number, colId: string) {
    const el = root.current?.querySelector<HTMLInputElement>(`input[data-gr="${rowIndex}"][data-gc="${colId}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, rowIndex: number, node: GridNode<T>, colId: string) {
    const col = editableIds.indexOf(colId);
    if (e.key === "ArrowDown" || e.key === "Enter") {
      e.preventDefault();
      focusCell(rowIndex + (e.shiftKey && e.key === "Enter" ? -1 : 1), colId);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusCell(rowIndex - 1, colId);
    } else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) {
      const next = editableIds[col + 1];
      if (next) {
        e.preventDefault();
        focusCell(rowIndex, next);
      }
    } else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) {
      const prev = editableIds[col - 1];
      if (prev) {
        e.preventDefault();
        focusCell(rowIndex, prev);
      }
    } else if (e.key === "Escape") {
      onRevert?.(node, colId);
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>, node: GridNode<T>, colId: string) {
    const text = e.clipboardData.getData("text/plain");
    if (!onPaste || !/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return; // a single value pastes normally
    e.preventDefault();
    const matrix = text.replace(/\r?\n$/, "").split(/\r?\n/).map((line) => line.split("\t"));
    const start = leaves.findIndex((l) => l.id === node.id);
    onPaste({ node, columnId: colId }, matrix, leaves.slice(Math.max(start, 0)));
  }

  function cellView(node: GridNode<T>, col: GridColumn<T>, rowIndex: number) {
    if (col.edit) {
      const c = col.edit.cell(node);
      const key = `${node.id}:${col.id}`;
      return (
        <input
          data-gr={rowIndex}
          data-gc={col.id}
          inputMode="decimal"
          aria-label={`${typeof col.header === "string" ? col.header : col.id} for ${node.id}`}
          aria-invalid={c.error ? true : undefined}
          title={c.error}
          value={c.value}
          readOnly={c.readOnly}
          placeholder={c.placeholder}
          onChange={(e) => onCellChange(node, col.id, e.target.value)}
          onKeyDown={(e) => onKeyDown(e, rowIndex, node, col.id)}
          onPaste={(e) => handlePaste(e, node, col.id)}
          onFocus={(e) => {
            setFocusKey(key);
            e.currentTarget.select();
          }}
          onBlur={() => setFocusKey((k) => (k === key ? null : k))}
          className={cn(
            "h-8 w-full rounded-sm border border-transparent bg-transparent px-2 text-right text-sm tabular-nums outline-none",
            "hover:border-border focus:border-ring focus:bg-background",
            c.dirty && "bg-amber-500/10",
            c.error && "border-destructive text-destructive",
            focusKey === key && "ring-1 ring-ring",
          )}
        />
      );
    }
    return col.render?.(node, { isGroup: false, childCount: 0 }) ?? null;
  }

  if (nodes.length === 0) return <div className={className}>{empty}</div>;

  return (
    <div ref={root} className={cn("overflow-auto rounded-md border border-border bg-background", className)}>
      <table className="w-full border-collapse text-sm" style={{ minWidth: "max-content" }}>
        <thead className="sticky top-0 z-10 bg-muted/60 text-xs font-medium text-muted-foreground backdrop-blur">
          <tr>
            {columns.map((col, i) => (
              <th
                key={col.id}
                scope="col"
                style={{ width: col.width, minWidth: col.width }}
                className={cn("border-b border-border px-2 py-2 text-left font-medium", col.align === "right" && "text-right", i === 0 && "sticky left-0 z-20 bg-muted")}
              >
                {col.header}
              </th>
            ))}
            {trailingHeader ? <th className="border-b border-border px-2 py-1 text-left font-medium">{trailingHeader}</th> : null}
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => {
            const kids = node.children ?? [];
            const isGroup = kids.length > 1;
            const open = expanded.has(node.id);
            const leafRows = isGroup ? (open ? kids : []) : [kids[0] ?? node];
            return (
              <FragmentRows key={node.id}>
                {isGroup ? (
                  <tr className="border-b border-border bg-muted/20">
                    {columns.map((col, i) => (
                      <td key={col.id} className={cn("px-2 py-1", col.align === "right" && "text-right", i === 0 && "sticky left-0 z-[1] bg-muted/30")}>
                        {i === 0 ? (
                          <button
                            type="button"
                            onClick={() => onToggleExpanded(node.id)}
                            aria-expanded={open}
                            className="flex w-full items-center gap-1.5 text-left font-medium text-foreground"
                          >
                            {open ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
                            <span className="truncate">{col.render?.(node, { isGroup: true, childCount: kids.length })}</span>
                          </button>
                        ) : (
                          (col.edit ? null : col.render?.(node, { isGroup: true, childCount: kids.length }))
                        )}
                      </td>
                    ))}
                    {trailingHeader ? <td /> : null}
                  </tr>
                ) : null}
                {leafRows.map((leaf) => {
                  const idx = leafIndexById.get(leaf.id) ?? 0;
                  return (
                    <tr key={leaf.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
                      {columns.map((col, i) => (
                        <td key={col.id} className={cn("px-1 py-0.5", col.align === "right" && "text-right", i === 0 && "sticky left-0 z-[1] bg-background", i === 0 && isGroup && "pl-8")}>
                          {col.edit ? cellView(leaf, col, idx) : (col.render?.(leaf, { isGroup: false, childCount: 0 }) ?? null)}
                        </td>
                      ))}
                      {trailingHeader ? <td className="px-1 py-0.5">{trailingCell?.(leaf)}</td> : null}
                    </tr>
                  );
                })}
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
