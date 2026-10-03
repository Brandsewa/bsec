import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, Mail, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, PageBreadcrumbs, PageContainer, PageSkeleton, toast } from "@bs/ui";
import { keepPreviousData, useQuery as useQuery2 } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { DataTable, type Column } from "../../components/data-table/data-table.tsx";
import { Pagination } from "../../components/data-table/pagination.tsx";
import { TableToolbar } from "../../components/data-table/table-toolbar.tsx";
import { BulkBar } from "../../components/data-table/toolbar-parts.tsx";
import { useTableSelection } from "../../components/data-table/use-table-selection.ts";
import { oneOf, parsePaging, text, useUrlTableState } from "../../components/data-table/use-table-state.ts";
import { SectionCard } from "../../components/section-card.tsx";
import { SimpleSelect } from "../../components/simple-select.tsx";
import { ScrollTabs } from "../../components/scroll-tabs.tsx";
import { ConditionsBuilder, ConditionsPreview, type RuleSet } from "../../components/segments/conditions-builder.tsx";
import { downloadCsv, toCsv } from "../../lib/csv.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/segments_/$segmentId")({
  pendingComponent: () => <PageSkeleton />,
  component: SegmentDetailPage,
});

const MEMBER_SORTS = [
  { id: "created_desc", label: "Newest first" },
  { id: "name_asc", label: "Name (A to Z)" },
  { id: "name_desc", label: "Name (Z to A)" },
  { id: "spent_desc", label: "Highest spend" },
  { id: "orders_desc", label: "Most orders" },
];

const MARKETING_LABEL: Record<string, string> = {
  subscribed: "Subscribed",
  unsubscribed: "Unsubscribed",
  not_subscribed: "Not subscribed",
  invalid: "Invalid",
};

const fmtDay = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function SegmentDetailPage() {
  const { segmentId } = Route.useParams();
  const queryClient = useQueryClient();
  const detail = useQuery(orpc.admin.segments.get.queryOptions({ input: { id: segmentId } }));
  const [tab, setTab] = useState<string>("customers");
  // ?edit=1 deep-links into edit mode (the create form navigates here with it).
  const [editMode, setEditMode] = useState(() => new URLSearchParams(window.location.search).get("edit") === "1");

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.segments.key() });

  if (detail.isLoading) {
    return (
      <PageContainer>
        <PageSkeleton />
      </PageContainer>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <PageContainer size="small">
        <PageBreadcrumbs items={[{ label: "Segments", href: "/segments" }, { label: "Segment" }]} />
        <EmptyState
          title="Could not load this segment"
          description={detail.error ? errorMessage(detail.error) : "It may have been deleted."}
          action={<Button onClick={() => void detail.refetch()}>Try again</Button>}
        />
      </PageContainer>
    );
  }

  const seg = detail.data;
  const setEdit = (edit: boolean) => setEditMode(edit);
  const setTabParam = (t: string) => setTab(t);

  return (
    <PageContainer size="full">
      <PageBreadcrumbs items={[{ label: "Segments", href: "/segments" }, { label: seg.name }]} />
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3">
        <Button variant="ghost" size="icon" aria-label="Back to segments" render={<Link to="/segments" />}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-x-2 text-lg font-semibold text-foreground">
            <span className="min-w-0 truncate">{seg.name}</span>
            {seg.kind === "automatic" ? <Badge variant="default" className="shrink-0">Automatic</Badge> : <Badge variant="secondary" className="shrink-0">Manual</Badge>}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {seg.memberCount.toLocaleString("en-IN")} customer{seg.memberCount === 1 ? "" : "s"}
            {seg.countedAt ? ` · as of ${new Date(seg.countedAt).toLocaleString("en-IN")}` : ""}
          </p>
        </div>
        {editMode ? (
          <Button variant="outline" size="sm" onClick={() => setEdit(false)}>
            Done editing
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setEdit(true)}>
            <Pencil className="mr-1.5 size-3.5" aria-hidden /> Edit
          </Button>
        )}
      </div>

      <ScrollTabs
        value={tab}
        onChange={setTabParam}
        tabs={[
          { id: "customers", label: "Customers" },
          ...(editMode ? [{ id: "settings", label: seg.kind === "automatic" ? "Conditions" : "Members" }] : []),
          { id: "activity", label: "Activity" },
        ]}
      />

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-4">
          {tab === "customers" ? <MembersTab segmentId={seg.id} kind={seg.kind} editMode={editMode} /> : null}
          {tab === "settings" && editMode ? <SettingsTab segment={seg} onSaved={refresh} /> : null}
          {tab === "activity" ? <ActivityTab segmentId={seg.id} /> : null}
        </div>

        <div className="grid gap-4">
          <SegmentRail segmentId={seg.id} kind={seg.kind} name={seg.name} memberCount={seg.memberCount} countedAt={seg.countedAt} />
        </div>
      </div>
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Customers tab
// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// Customers tab: the orders-style rich table (selection, toolbar, sort, paging, export).
// ---------------------------------------------------------------------------------------------------------------

export interface MembersSearch {
  q?: string | undefined;
  sort: "created_desc" | "name_asc" | "name_desc" | "spent_desc" | "orders_desc";
  page: number;
  size: number;
}

export function parseMembersSearch(raw: Record<string, unknown>): MembersSearch {
  return {
    q: text(raw["q"]),
    sort: oneOf(raw["sort"], ["created_desc", "name_asc", "name_desc", "spent_desc", "orders_desc"] as const) ?? "created_desc",
    ...parsePaging(raw),
  };
}

export function membersListInput(segmentId: string, s: MembersSearch, paging: { limit: number; offset: number } = { limit: s.size, offset: (s.page - 1) * s.size }) {
  return {
    id: segmentId,
    ...(s.q ? { search: s.q } : {}),
    sort: s.sort,
    ...paging,
  };
}

type MemberRow = Awaited<ReturnType<typeof client.admin.segments.members.list>>["items"][number];

function MembersTab({ segmentId, kind, editMode }: { segmentId: string; kind: "manual" | "automatic"; editMode: boolean }) {
  const queryClient = useQueryClient();
  const [s, update] = useUrlTableState(parseMembersSearch);
  const [subscribedOnly, setSubscribedOnly] = useState(true);
  const [removing, setRemoving] = useState<MemberRow[] | null>(null);

  const members = useQuery2({
    ...orpc.admin.segments.members.list.queryOptions({ input: membersListInput(segmentId, s) }),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => members.data?.items ?? [], [members.data]);
  const total = members.data?.total ?? 0;
  const setSearchText = (v: string) => update({ q: v.trim() || undefined, page: undefined });
  const setFilter = (patch: Record<string, unknown>) => update({ ...patch, page: undefined });

  const sel = useTableSelection({
    rows,
    getId: (m: MemberRow) => m.id,
    total,
    resetKey: JSON.stringify([s.q, s.sort]),
  });
  const canBulkRemove = kind === "manual" && editMode;

  const refresh = () => {
    sel.release([]);
    void queryClient.invalidateQueries({ queryKey: orpc.admin.segments.members.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.admin.segments.key() });
  };

  const runRemove = (targets: MemberRow[]) => {
    void client.admin.segments.members
      .remove({ id: segmentId, customerIds: targets.map((m) => m.id) })
      .then((res) => {
        toast.success(`Removed ${res.removed} customer${res.removed === 1 ? "" : "s"} from the segment.`);
        refresh();
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  const exportCsv = async (source: "selection" | "matching") => {
    try {
      const picked = new Set(sel.picked.map((m) => m.id));
      const all: Array<Array<string | number | null>> = [];
      let offset = 0;
      for (;;) {
        const page = await client.admin.segments.members.list(membersListInput(segmentId, s, { limit: 100, offset }));
        for (const m of page.items) {
          if (source === "selection" && !picked.has(m.id)) continue;
          if (subscribedOnly && m.marketingState !== "subscribed") continue;
          all.push([m.name, m.email, m.phone, m.ordersCount, (m.totalSpent / 100).toFixed(2), m.lastOrderAt ? new Date(m.lastOrderAt).toISOString() : "", MARKETING_LABEL[m.marketingState] ?? m.marketingState, m.tags.join("; ")]);
        }
        offset += 100;
        if (offset >= page.total) break;
      }
      downloadCsv(`segment-${segmentId.slice(0, 8)}-customers.csv`, toCsv(["Name", "Email", "Phone", "Orders", "Total spent (INR)", "Last order", "Marketing state", "Tags"], all));
      toast.success(`Exported ${all.length.toLocaleString("en-IN")} customer${all.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<MemberRow>[] = [
    {
      id: "customer",
      header: "Customer",
      sort: { asc: "name_asc", desc: "name_desc" },
      cell: (m) => (
        <div className="flex max-w-60 flex-col">
          <span className="truncate font-medium text-foreground">{m.name || "Unnamed"}</span>
          <span className="truncate text-muted-foreground">{m.email}</span>
        </div>
      ),
    },
    { id: "phone", header: "Phone", optional: true, defaultHidden: true, className: "text-muted-foreground", cell: (m) => m.phone },
    { id: "orders", header: "Orders", className: "font-medium text-foreground", cell: (m) => `${m.ordersCount} orders` },
    { id: "spent", header: "Spent", className: "text-right font-medium text-foreground", cell: (m) => `₹${(m.totalSpent / 100).toLocaleString("en-IN")}` },
    { id: "lastOrder", header: "Last order", className: "text-muted-foreground", cell: (m) => fmtDay(m.lastOrderAt) },
    {
      id: "marketing",
      header: "Marketing",
      cell: (m) => MARKETING_LABEL[m.marketingState] ?? m.marketingState,
    },
    {
      id: "tags",
      header: "Tags",
      optional: true,
      cell: (m) => (
        <div className="flex flex-wrap gap-1">
          {m.tags.slice(0, 2).map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
          {m.tags.length > 2 ? <span className="text-muted-foreground">+{m.tags.length - 2}</span> : null}
        </div>
      ),
    },
  ];
  const shown = columns;

  const empty = s.q ? (
    <div className="grid justify-items-center gap-1">
      <p className="text-sm font-medium text-foreground">No customers match</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={() => setFilter({ q: undefined })}>
        Clear search
      </Button>
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">No customers in this segment yet.</p>
  );

  return (
    <div className="grid gap-3">
      <TableToolbar
        searchLabel="Search members"
        searchPlaceholder="Search name, email, phone"
        searchText={s.q ?? ""}
        onSearchText={setSearchText}
        filters={
          <div className="flex items-center gap-2">
            <SimpleSelect ariaLabel="Sort members" className="w-44" value={s.sort} options={MEMBER_SORTS.map((o) => ({ value: o.id, label: o.label }))} onChange={(v) => setFilter({ sort: v })} />
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Checkbox checked={subscribedOnly} onCheckedChange={(v) => setSubscribedOnly(v === true)} aria-label="Subscribed only" />
              Subscribed only in export
            </label>
          </div>
        }
        hasFilters={Boolean(s.q)}
        activeFilterCount={s.q ? 1 : 0}
        onClearFilters={() => setFilter({ q: undefined })}
        resultCount={total}
        noun="customers"
        sortOptions={MEMBER_SORTS}
        sort={s.sort}
        defaultSort="created_desc"
        onSort={(v) => setFilter({ sort: v })}
        trailing={
          <Button variant="outline" size="sm" disabled={total === 0} onClick={() => void exportCsv("matching")}>
            <Download className="mr-1.5 size-3.5" aria-hidden /> Export CSV
          </Button>
        }
      />

      <BulkBar
        count={sel.count}
        noun="customer"
        total={total}
        allResults={sel.allResults}
        pageFullySelected={sel.pageFullySelected}
        onSelectAllResults={sel.selectAllResults}
        onClear={sel.clear}
        note={sel.allResults ? "Bulk actions work on customers you tick yourself." : undefined}
      >
        <Button variant="outline" size="sm" disabled={sel.picked.length === 0} onClick={() => void exportCsv("selection")}>
          <Download className="mr-1.5" /> Export selected
        </Button>
        {canBulkRemove ? (
          <Button variant="destructive" size="sm" disabled={sel.allResults || sel.picked.length === 0} onClick={() => setRemoving(sel.picked)}>
            <Trash2 className="mr-1.5" /> Remove from segment
          </Button>
        ) : null}
      </BulkBar>

      <DataTable
        columns={shown}
        rows={rows}
        getRowId={(m) => m.id}
        isLoading={members.isLoading}
        isFetching={members.isFetching}
        error={members.isError ? { message: errorMessage(members.error), onRetry: () => void members.refetch() } : null}
        empty={empty}
        selectedIds={sel.selectedIds}
        onToggleRow={sel.toggleRow}
        onTogglePage={sel.togglePage}
        sort={s.sort}
        onSortChange={(v) => setFilter({ sort: v === "created_desc" ? undefined : v })}
        renderCard={(m) => (
          <div className="grid gap-1 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-foreground">{m.name || "Unnamed"}</span>
              <span className="font-medium text-foreground">₹{(m.totalSpent / 100).toLocaleString("en-IN")}</span>
            </div>
            <p className="truncate text-muted-foreground">{m.email}</p>
            <p className="text-muted-foreground">
              {m.ordersCount} orders · {MARKETING_LABEL[m.marketingState] ?? m.marketingState}
            </p>
          </div>
        )}
      />

      <Pagination
        page={s.page}
        pageSize={s.size}
        total={total}
        disabled={members.isFetching}
        onPageChange={(p) => update({ page: p === 1 ? undefined : p })}
        onPageSizeChange={(n) => update({ size: n === 25 ? undefined : n, page: undefined })}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={(removing?.length ?? 0) === 1 ? `Remove ${removing?.[0]?.name || removing?.[0]?.email} from the segment?` : `Remove ${removing?.length} customers from the segment?`}
        description="They keep all their data; they are just no longer in this segment."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          const targets = removing ?? [];
          setRemoving(null);
          runRemove(targets);
        }}
      />
    </div>
  );
}

function SettingsTab({ segment, onSaved }: { segment: Awaited<ReturnType<typeof client.admin.segments.get>>; onSaved: () => void }) {
  const [name, setName] = useState(segment.name);
  const [description, setDescription] = useState(segment.description ?? "");
  const [rules, setRules] = useState<RuleSet>(segment.rules ?? { match: "all", conditions: [{ field: "orders_count", op: "gte", value: 1 }] });
  const [saving, setSaving] = useState(false);
  const dirty = name !== segment.name || description !== (segment.description ?? "");

  const save = async () => {
    setSaving(true);
    try {
      await client.admin.segments.update({ id: segment.id, name: name.trim(), description: description.trim() || null, ...(segment.kind === "automatic" ? { rules } : {}) });
      toast.success("Segment saved.");
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <SectionCard title="Details">
        <div className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-sm text-muted-foreground">Name</span>
            <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm text-muted-foreground">Description (optional)</span>
            <Input value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div>
            <Button size="sm" disabled={saving || (!dirty && segment.kind !== "automatic")} onClick={() => void save()}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </SectionCard>

      {segment.kind === "automatic" ? (
        <SectionCard title="Conditions" description="The type cannot change after the segment is created.">
          <div className="grid gap-4">
            <ConditionsBuilder rules={rules} onChange={setRules} />
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Live preview</p>
              <ConditionsPreview rules={rules} />
            </div>
            <div>
              <Button size="sm" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save conditions"}
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : (
        <ManualMembersEditor segmentId={segment.id} />
      )}
    </div>
  );
}

function ManualMembersEditor({ segmentId }: { segmentId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [paste, setPaste] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const members = useQuery(orpc.admin.segments.members.list.queryOptions({ input: { id: segmentId, limit: 50 } }));
  const candidates = useQuery({
    ...orpc.admin.customers.list.queryOptions({ input: { search: search.trim() || undefined, limit: 5 } }),
    enabled: search.trim().length > 1,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.segments.key() });

  const add = async (customerIds?: string[], emails?: string[]) => {
    try {
      const res = await client.admin.segments.members.add({ id: segmentId, customerIds, emails });
      const parts = [`${res.added} added`, res.alreadyIn > 0 ? `${res.alreadyIn} already in` : "", res.notFound.length > 0 ? `${res.notFound.length} not found (${res.notFound.slice(0, 3).join(", ")}${res.notFound.length > 3 ? "…" : ""})` : ""].filter(Boolean);
      toast.success(parts.join(", ") || "Nothing to add.");
      setPaste("");
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (customerId: string) => {
    try {
      await client.admin.segments.members.remove({ id: segmentId, customerIds: [customerId] });
      toast.success("Removed from segment.");
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-4">
      <SectionCard title="Add customers" description="Search by name, email or phone, or paste emails (one per line or comma separated).">
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Input aria-label="Search customers to add" placeholder="Search customers…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {(candidates.data?.items ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{c.name || "Unnamed"}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void add([c.id])}>
                  Add
                </Button>
              </div>
            ))}
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm text-muted-foreground">Add by email</span>
            <textarea
              aria-label="Paste emails"
              className="min-h-20 rounded-md border border-border bg-background p-2 text-sm"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"one@email.com, two@email.com"}
            />
          </label>
          <div>
            <Button variant="outline" size="sm" disabled={!paste.trim()} onClick={() => void add(undefined, paste.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))}>
              Add by email
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={`Members (${members.data?.total ?? 0})`}>
        {(members.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <ul className="grid gap-2">
            {(members.data?.items ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{m.name || "Unnamed"}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label={`Remove ${m.name || m.email}`} onClick={() => setRemoving(m.id)}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(open) => !open && setRemoving(null)}
          title="Remove this customer from the segment?"
          description="They keep all their data; they are just no longer in this segment."
          confirmLabel="Remove"
          destructive
          onConfirm={() => {
            const id = removing;
            setRemoving(null);
            if (id) void remove(id);
          }}
        />
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Activity tab
// ---------------------------------------------------------------------------------------------------------------

const ACTION_LABEL: Record<string, string> = {
  "segment.created": "Segment created",
  "segment.updated": "Segment updated",
  "segment.deleted": "Segment deleted",
  "segment.members_added": "Customers added",
  "segment.members_removed": "Customers removed",
};

function ActivityTab({ segmentId }: { segmentId: string }) {
  const activity = useQuery(orpc.admin.segments.activity.queryOptions({ input: { id: segmentId } }));
  if (activity.isLoading) return <p className="text-sm text-muted-foreground">Loading activity…</p>;
  if (activity.isError) return <p className="text-sm text-destructive">{errorMessage(activity.error)}</p>;
  if ((activity.data?.items.length ?? 0) === 0) return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
  return (
    <ol className="relative grid gap-3 border-l border-border pl-4">
      {(activity.data?.items ?? []).map((item) => (
        <li key={item.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-muted-foreground/40" aria-hidden />
          <p className="text-sm font-medium text-foreground">{ACTION_LABEL[item.action] ?? item.action}</p>
          <p className="text-xs text-muted-foreground">
            {item.actorType} · {new Date(item.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}
            {item.action === "segment.members_added" || item.action === "segment.members_removed"
              ? ` · ${String((item.diff as { added?: number; removed?: number }).added ?? (item.diff as { removed?: number }).removed ?? 0)} customer(s)`
              : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Right rail
// ---------------------------------------------------------------------------------------------------------------

function SegmentRail({ segmentId, kind, name, memberCount, countedAt }: { segmentId: string; kind: string; name: string; memberCount: number; countedAt: string | null }) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = async () => {
    try {
      const res = await client.admin.segments.refreshCount({ id: segmentId });
      toast.success(`${name}: ${res.memberCount.toLocaleString("en-IN")} customers.`);
      void queryClient.invalidateQueries({ queryKey: orpc.admin.segments.key() });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-4">
      <SectionCard title="Summary">
        <div className="grid gap-1.5 text-sm">
          <p className="text-muted-foreground">
            Type: <span className="text-foreground">{kind === "automatic" ? "Automatic" : "Manual"}</span>
          </p>
          <p className="text-muted-foreground">
            Customers: <span className="tabular-nums text-foreground">{memberCount.toLocaleString("en-IN")}</span>
          </p>
          <p className="text-muted-foreground">As of: {fmtDay(countedAt)}</p>
          <div>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              <RefreshCw className="mr-1.5 size-3.5" aria-hidden /> Refresh count
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Use this segment" description="Segments group and export only.">
        <div className="grid gap-2">
          <Button variant="outline" size="sm" render={<Link to="/customers" />}>
            View customers
          </Button>
          <p className="text-xs text-muted-foreground">Export with a marketing-state column from the Customers tab; subscribed only is on by default.</p>
          <Button variant="outline" size="sm" disabled aria-disabled title="Email sending is not set up yet">
            <Mail className="mr-1.5 size-3.5" aria-hidden /> Send email
          </Button>
          <p className="text-xs text-muted-foreground">Email sending is not set up yet.</p>
        </div>
      </SectionCard>

      <SectionCard title="Danger zone">
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="mr-1.5 size-3.5" aria-hidden /> Delete segment
        </Button>
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete "${name}"?`}
          description="Customers themselves are not touched."
          confirmLabel="Delete segment"
          destructive
          onConfirm={() => {
            void client.admin.segments
              .delete({ id: segmentId })
              .then(() => {
                toast.success(`Deleted "${name}".`);
                window.location.href = "/segments";
              })
              .catch((e: unknown) => toast.error(errorMessage(e)));
          }}
        />
      </SectionCard>
    </div>
  );
}
