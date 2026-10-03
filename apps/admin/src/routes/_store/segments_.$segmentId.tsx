import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, Mail, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { EmptyState, PageBreadcrumbs, PageContainer, PageSkeleton, toast } from "@bs/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
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
  { value: "created_desc", label: "Newest first" },
  { value: "name_asc", label: "Name (A to Z)" },
  { value: "name_desc", label: "Name (Z to A)" },
  { value: "spent_desc", label: "Highest spend" },
  { value: "orders_desc", label: "Most orders" },
] as const;

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
  const [editMode, setEditMode] = useState(false);

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
          <h1 className="flex items-center gap-2 truncate text-lg font-semibold text-foreground">
            {seg.name}
            {seg.kind === "automatic" ? <Badge variant="default">Automatic</Badge> : <Badge variant="secondary">Manual</Badge>}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {seg.memberCount.toLocaleString("en-IN")} customers{seg.countedAt ? ` · as of ${new Date(seg.countedAt).toLocaleString("en-IN")}` : ""}
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
          {tab === "customers" ? <MembersTab segmentId={seg.id} /> : null}
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

function MembersTab({ segmentId }: { segmentId: string }) {
  const [searchText, setSearchText] = useState("");
  const [sort, setSort] = useState<string>("created_desc");
  const [subscribedOnly, setSubscribedOnly] = useState(true);
  const members = useQuery(orpc.admin.segments.members.list.queryOptions({ input: { id: segmentId, search: searchText.trim() || undefined, sort: sort as "created_desc", limit: 50 } }));
  void subscribedOnly;

  const exportCsv = async () => {
    try {
      const all: Array<Array<string | number | null>> = [];
      let offset = 0;
      for (;;) {
        const page = await client.admin.segments.members.list({ id: segmentId, sort: sort as "created_desc", limit: 100, offset, ...(subscribedOnly ? {} : {}) });
        for (const m of page.items) {
          if (subscribedOnly && m.marketingState !== "subscribed") continue;
          all.push([m.name, m.email, m.phone, m.ordersCount, (m.totalSpent / 100).toFixed(2), m.lastOrderAt ? new Date(m.lastOrderAt).toISOString() : "", MARKETING_LABEL[m.marketingState] ?? m.marketingState, m.tags.join("; ")]);
        }
        offset += 100;
        if (offset >= page.total) break;
      }
      downloadCsv(`segment-${segmentId.slice(0, 8)}-customers.csv`, toCsv(["Name", "Email", "Phone", "Orders", "Total spent (INR)", "Last order", "Marketing state", "Tags"], all));
      toast.success(`Exported ${all.length.toLocaleString("en-IN")} customers.`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search members" placeholder="Search name, email, phone" className="max-w-xs" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        <SimpleSelect ariaLabel="Sort members" className="w-44" value={sort} options={MEMBER_SORTS.map((o) => ({ value: o.value, label: o.label }))} onChange={setSort} />
        <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
          <Download className="mr-1.5 size-3.5" aria-hidden /> Export CSV
        </Button>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" aria-label="Subscribed only" checked={subscribedOnly} onChange={(e) => setSubscribedOnly(e.target.checked)} />
          Subscribed only (recommended for anything you send)
        </label>
      </div>

      {members.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading customers…</p>
      ) : members.isError ? (
        <p className="text-sm text-destructive">{errorMessage(members.error)}</p>
      ) : (members.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">No customers in this segment{searchText ? " for this search" : " yet"}.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 text-right font-medium">Orders</th>
                <th className="px-3 py-2 text-right font-medium">Spent</th>
                <th className="px-3 py-2 font-medium">Last order</th>
                <th className="px-3 py-2 font-medium">Marketing</th>
                <th className="px-3 py-2 font-medium">Tags</th>
              </tr>
            </thead>
            <tbody>
              {(members.data?.items ?? []).map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="max-w-56 px-3 py-2">
                    <p className="truncate font-medium text-foreground">{m.name || "Unnamed"}</p>
                    <p className="truncate text-muted-foreground">{m.email}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.ordersCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">₹{(m.totalSpent / 100).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDay(m.lastOrderAt)}</td>
                  <td className="px-3 py-2">{MARKETING_LABEL[m.marketingState] ?? m.marketingState}</td>
                  <td className="max-w-40 px-3 py-2">
                    <span className="truncate text-muted-foreground">{m.tags.join(", ") || "—"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Settings tab (edit mode): details + conditions for automatic, members for manual
// ---------------------------------------------------------------------------------------------------------------

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
