import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/table.tsx";
import { TableSkeleton } from "../components/skeleton.tsx";
import { EmptyState } from "../components/empty-state.tsx";

export interface ColumnDef<T> {
  header: ReactNode;
  accessorKey?: keyof T | undefined;
  cell?: ((item: T) => ReactNode) | undefined;
  className?: string | undefined;
  headerClassName?: string | undefined;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  keyExtractor: (item: T) => string;
  isLoading?: boolean | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: ReactNode | undefined;
  emptyAction?: ReactNode | undefined;
  onRowClick?: ((item: T) => void) | undefined;
  className?: string | undefined;
}

/**
 * DataTable (Supabase design pattern ported to shop admin).
 * Standard tabular data grid with automatic skeleton loading, empty state,
 * column layout, and optional row click handlers.
 */
export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  isLoading,
  emptyTitle = "No items found",
  emptyDescription,
  emptyAction,
  onRowClick,
  className,
}: DataTableProps<T>) {
  if (isLoading) {
    return <TableSkeleton rows={5} columns={columns.length} />;
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          {columns.map((col, idx) => (
            <TableHead key={idx} className={col.headerClassName}>
              {col.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((item) => {
          const key = keyExtractor(item);
          return (
            <TableRow
              key={key}
              onClick={() => onRowClick?.(item)}
              className={cn(onRowClick && "cursor-pointer hover:bg-surface-75")}
            >
              {columns.map((col, idx) => {
                const cellContent = col.cell
                  ? col.cell(item)
                  : col.accessorKey
                    ? (item[col.accessorKey] as ReactNode)
                    : null;
                return (
                  <TableCell key={idx} className={col.className}>
                    {cellContent}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
