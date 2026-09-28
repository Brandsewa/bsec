import type { ReactNode } from "react";
import { PageContainer } from "../layout/page.tsx";
import { Skeleton } from "../components/skeleton.tsx";

/**
 * Admin route template (PLAN §12). Every TanStack route declares its own skeleton:
 *
 *   export const Route = createFileRoute("/orders")({
 *     pendingComponent: () => <PageSkeleton><TableSkeleton rows={10} /></PageSkeleton>,
 *     loader: ...,
 *     component: OrdersPage,
 *   });
 *
 * The router sets defaultPendingMs 150 (fast loads show nothing) and defaultPendingMinMs 300
 * (a skeleton, once shown, never flickers). The bs/route-pending lint rule enforces the key.
 */
export const ROUTE_PENDING_MS = 150;
export const ROUTE_PENDING_MIN_MS = 300;

/** Page frame skeleton: breadcrumbs row + header + body slot. Matches PageContainer/PageHeader spacing. */
export function PageSkeleton({ size = "default", children }: { size?: "small" | "default" | "full"; children?: ReactNode }) {
  return (
    <PageContainer size={size} aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <div className="grid gap-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {children}
    </PageContainer>
  );
}
