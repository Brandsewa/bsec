import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Copy, MoreHorizontal, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSection, PageSkeleton, TableSkeleton, toast } from "@bs/ui";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { DataTable, type Column } from "../../components/data-table/data-table.tsx";
import { useTableSelection } from "../../components/data-table/use-table-selection.ts";
import { BulkBar } from "../../components/data-table/toolbar-parts.tsx";
import { useUrlTableState, compactSearch, oneOf, parsePaging, text } from "../../components/data-table/use-table-state.ts";
import { ScrollTabs } from "../../components/scroll-tabs.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

// ---------------------------------------------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------------------------------------------

type KindView = "all" | "automatic" | "manual";

export interface SegmentsSearch {
  view: KindView;
  q?: string | undefined;
  page: number;
  size: number;
}

export function parseSegmentsSearch(raw: Record<string, unknown>): SegmentsSearch {
  return {
    view: oneOf(raw["view"], ["all", "automatic", "manual"] as const) ?? "all",
    q: text(raw["q"]),
    ...parsePaging(raw),
  };
}

export function segmentsListInput(s: SegmentsSearch, paging: { limit: number; offset: number } = { limit: s.size, offset: (s.page - 1) * s.size }) {
  return {
    ...(s.view !== "all" ? { kind: s.view } : {}),
    ...paging,
  };
}

type SegmentRow = Awaited<ReturnType<typeof client.admin.segments.list>>["items"][number];

const TABS: ReadonlyArray<{ id: KindView; label: string }> = [
  { id: "all", label: "All" },
  { id: "automatic", label: "Automatic" },
  { id: "manual", label: "Manual" },
];

function SegmentsStatsStrip() {
  const stats = useQuery(orpc.admin.segments.list.queryOptions({ input: { limit: 100 } }));
  if (stats.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    );
  }
  const items = stats.data?.items ?? [];
  const automatic = items.filter((s) => s.kind === "automatic").length;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      <MetricCard label="Total segments" value={items.length.toLocaleString("en-IN")} />
      <MetricCard label="Automatic" value={automatic.toLocaleString("en-IN")} />
      <MetricCard label="Manual" value={(items.length - automatic).toLocaleString("en-IN")} />
    </div>
  );
}

export const Route = createFileRoute("/_store/segments")({
  validateSearch: (raw: Record<string, unknown>): Partial<SegmentsSearch> =>
    compactSearch(parseSegmentsSearch(raw), { view: "all", page: 1, size: 25 }),
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={8} columns={4} />
    </PageSkeleton>
  ),
  component: SegmentsPage,
});

export function SegmentsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [s, update] = useUrlTableState(parseSegmentsSearch);
  const [deleting, setDeleting] = useState<SegmentRow | null>(null);
  const setFilter = (patch: Record<string, unknown>) => update({ ...patch, page: undefined });
  const setSearchText = (v: string) => update({ q: v.trim() || undefined, page: undefined });

  const list = useQuery({ ...orpc.admin.segments.list.queryOptions({ input: segmentsListInput(s) }), placeholderData: keepPreviousData });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const sel = useTableSelection({ rows, getId: (seg: SegmentRow) => seg.id, total, resetKey: JSON.stringify([s.view]) });
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.segments.key() });

  const open = (id: string) => void navigate({ to: "/segments/$segmentId", params: { segmentId: id } });

  const duplicate = async (seg: SegmentRow) => {
    try {
      const full = await client.admin.segments.get({ id: seg.id });
      const created = await client.admin.segments.create({
        name: `${seg.name} copy`,
        description: full.description ?? undefined,
        kind: full.kind,
        rules: full.rules ?? undefined,
      });
      toast.success(`Duplicated as "${created.name}".`);
      open(created.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const refreshCount = async (seg: SegmentRow) => {
    try {
      const res = await client.admin.segments.refreshCount({ id: seg.id });
      toast.success(`${seg.name}: ${res.memberCount.toLocaleString("en-IN")} customers.`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const runBulkDelete = () => {
    const targets = sel.picked;
    void (async () => {
      let done = 0;
      for (const seg of targets) {
        try {
          await client.admin.segments.delete({ id: seg.id });
          done++;
        } catch (e) {
          toast.error(`${seg.name}: ${errorMessage(e)}`);
        }
      }
      toast.success(`Deleted ${done} segment${done === 1 ? "" : "s"}.`);
      sel.release([]);
      setBulkDeleting(false);
      refresh();
    })();
  };

  const createPresets = async () => {
    try {
      const res = await client.admin.segments.presets.create();
      toast.success(`${res.created} template segment${res.created === 1 ? "" : "s"} created.`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<SegmentRow>[] = [
    {
      id: "name",
      header: "Segment",
      cell: (seg) => (
        <div className="flex max-w-72 flex-col">
          <span className="truncate font-medium text-foreground">{seg.name}</span>
          {seg.description ? <span className="truncate text-muted-foreground">{seg.description}</span> : null}
        </div>
      ),
    },
    {
      id: "kind",
      header: "Type",
      cell: (seg) =>
        seg.kind === "automatic" ? (
          <Badge variant="default">Automatic</Badge>
        ) : (
          <Badge variant="secondary">Manual</Badge>
        ),
    },
    {
      id: "customers",
      header: "Customers",
      className: "text-right font-medium text-foreground",
      cell: (seg) => (
        <span title={seg.countedAt ? `As of ${new Date(seg.countedAt).toLocaleString("en-IN")}` : "Not counted yet"} className="tabular-nums">
          {seg.memberCount.toLocaleString("en-IN")}
        </span>
      ),
    },
    {
      id: "updated",
      header: "Updated",
      className: "text-muted-foreground",
      cell: (seg) => new Date(seg.updatedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    },
  ];

  const rowMenu = (seg: SegmentRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${seg.name}`} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onClick={() => open(seg.id)}>Open segment</DropdownMenuItem>
        <DropdownMenuItem disabled={list.isFetching} onClick={() => void refreshCount(seg)}>
          <RefreshCw /> Refresh count
        </DropdownMenuItem>
        <DropdownMenuItem disabled={bulkGuard()} onClick={() => void duplicate(seg)}>
          <Copy /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => setDeleting(seg)}>
          <Trash2 /> Delete segment
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const bulkGuard = () => false;

  const empty =
    s.view !== "all" ? (
      <div className="grid justify-items-center gap-1">
        <p className="text-sm font-medium text-foreground">No {s.view} segments</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setFilter({ view: undefined })}>
          Show all segments
        </Button>
      </div>
    ) : (
      <div className="grid justify-items-center gap-3 py-6">
        <p className="text-sm font-medium text-foreground">No segments yet</p>
        <p className="max-w-md text-center text-muted-foreground">Group customers with conditions that stay up to date, or pick the customers yourself. Start from a template or create your own.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void createPresets()}>
            <Sparkles className="mr-1.5 size-3.5" aria-hidden /> Start from a template
          </Button>
          <Button size="sm" render={<a href="/segments/new" />}>
            <Plus className="mr-1.5 size-3.5" aria-hidden /> Create segment
          </Button>
        </div>
      </div>
    );

  return (
    <PageContainer size="full">
      <PageHeader
        title="Segments"
        description="Groups of customers: automatic ones stay up to date from conditions, manual ones you fill yourself. Grouping and export only — nothing is sent from here."
        aside={
          <Button size="sm" render={<Link to="/segments/new" />}>
            <Plus className="mr-1.5 size-3.5" aria-hidden /> Create segment
          </Button>
        }
      />

      <SegmentsStatsStrip />

      <ScrollTabs value={s.view} onChange={(v) => setFilter({ view: v === "all" ? undefined : v })} tabs={TABS} />

      <PageSection>
        <div className="grid gap-3">
          <Input aria-label="Search segments" placeholder="Search segments" className="max-w-xs" value={s.q ?? ""} onChange={(e) => setSearchText(e.target.value)} />

          <BulkBar
            count={sel.count}
            noun="segment"
            total={total}
            allResults={sel.allResults}
            pageFullySelected={sel.pageFullySelected}
            onSelectAllResults={sel.selectAllResults}
            onClear={sel.clear}
            note="Bulk actions work on segments you tick yourself."
          >
            <Button variant="destructive" size="sm" disabled={bulkDeleting || sel.allResults || sel.picked.length === 0} onClick={() => setBulkDeleting(true)}>
              <Trash2 className="mr-1.5" /> Delete selected
            </Button>
          </BulkBar>

          <DataTable
            columns={columns}
            rows={rows.filter((r) => !s.q || r.name.toLowerCase().includes(s.q.toLowerCase()))}
            getRowId={(seg) => seg.id}
            isLoading={list.isLoading}
            isFetching={list.isFetching}
            error={list.isError ? { message: errorMessage(list.error), onRetry: () => void list.refetch() } : null}
            empty={empty}
            selectedIds={sel.selectedIds}
            onToggleRow={sel.toggleRow}
            onTogglePage={sel.togglePage}
            onRowClick={(seg) => open(seg.id)}
            rowActions={rowMenu}
            renderCard={(seg) => (
              <div className="grid gap-1 p-3" onClick={() => open(seg.id)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-foreground">{seg.name}</span>
                  {seg.kind === "automatic" ? <Badge variant="default">Automatic</Badge> : <Badge variant="secondary">Manual</Badge>}
                </div>
                {seg.description ? <p className="truncate text-muted-foreground">{seg.description}</p> : null}
                <p className="text-muted-foreground">
                  {seg.memberCount.toLocaleString("en-IN")} customers · updated {new Date(seg.updatedAt).toLocaleDateString("en-IN")}
                </p>
              </div>
            )}
          />
        </div>
      </PageSection>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description={
          deleting?.kind === "manual"
            ? "The segment and its member list are deleted. Customers themselves are not touched."
            : "The segment and its conditions are deleted. Customers themselves are not touched."
        }
        confirmLabel="Delete segment"
        destructive
        onConfirm={() => {
          const seg = deleting;
          setDeleting(null);
          if (seg) {
            void client.admin.segments
              .delete({ id: seg.id })
              .then(() => {
                toast.success(`Deleted "${seg.name}".`);
                refresh();
              })
              .catch((e: unknown) => toast.error(errorMessage(e)));
          }
        }}
      />

      <ConfirmDialog
        open={bulkDeleting}
        onOpenChange={setBulkDeleting}
        title={`Delete ${sel.picked.length} segments?`}
        description="The segments and their conditions or member lists are deleted. Customers themselves are not touched."
        confirmLabel="Delete segments"
        destructive
        onConfirm={runBulkDelete}
      />
    </PageContainer>
  );
}
export default SegmentsPage;
