import { createFileRoute } from "@tanstack/react-router";
import { Download, MailX, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, PageContainer, PageHeader, PageSection, PageSkeleton, ScrollTabs, SimpleSelect, TableSkeleton, toast } from "@bs/ui";
import { DataTable, type Column } from "../../components/data-table/data-table.tsx";
import { fetchAllPages } from "../../components/data-table/fetch-all.ts";
import { Pagination } from "../../components/data-table/pagination.tsx";
import { downloadCsv, toCsv } from "../../lib/csv.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

type Row = Awaited<ReturnType<typeof client.admin.leads.list>>["items"][number];
type Tab = "all" | "subscribed" | "unsubscribed";

export const Route = createFileRoute("/_store/leads")({
  pendingComponent: () => (
    <PageSkeleton>
      <TableSkeleton rows={8} columns={4} />
    </PageSkeleton>
  ),
  component: LeadsPage,
});

const SOURCE_LABEL: Record<string, string> = { storefront_form: "Footer form", storefront: "Footer form", blog: "Blog header", checkout: "Checkout", account_page: "Account page", admin: "Added by store" };
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

function LeadsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("all");
  const [source, setSource] = useState("any");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);

  const filters = { ...(tab !== "all" ? { status: tab } : {}), ...(source !== "any" ? { source } : {}), ...(search.trim() ? { search: search.trim() } : {}) };
  const list = useQuery({ ...orpc.admin.leads.list.queryOptions({ input: { ...filters, limit: size, offset: (page - 1) * size } }), placeholderData: keepPreviousData });
  const unsub = useMutation(
    orpc.admin.leads.unsubscribe.mutationOptions({
      onSuccess: () => {
        toast.success("Unsubscribed.");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.leads.key() });
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
  );

  async function exportAll() {
    try {
      const { rows } = await fetchAllPages((offset, limit) => client.admin.leads.list({ ...filters, limit, offset }));
      downloadCsv(`leads-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(["email", "status", "source", "consented_at", "unsubscribed_at"], rows.map((r) => [r.email, r.status, r.source, r.consentAt, r.unsubscribedAt ?? ""])));
      toast.success(`Exported ${rows.length} leads.`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const columns: Column<Row>[] = [
    { id: "email", header: "Email", className: "font-medium text-foreground", cell: (r) => r.email },
    { id: "source", header: "Source", className: "text-muted-foreground", cell: (r) => <Badge variant="outline">{sourceLabel(r.source)}</Badge> },
    { id: "status", header: "Status", cell: (r) => (r.status === "subscribed" ? <Badge>Subscribed</Badge> : <Badge variant="secondary">Unsubscribed</Badge>) },
    { id: "date", header: "Signed up", className: "whitespace-nowrap text-muted-foreground", cell: (r) => new Date(r.consentAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) },
  ];
  const sourceOptions = [{ value: "any", label: "Source: any" }, ...(list.data?.sources ?? []).map((s) => ({ value: s, label: sourceLabel(s) }))];

  return (
    <PageContainer size="full">
      <PageHeader
        title="Leads"
        description="People who signed up for your newsletter from the footer or the blog. They are not customers until they order."
        aside={
          <Button variant="outline" size="sm" disabled={(list.data?.total ?? 0) === 0} onClick={() => void exportAll()}>
            <Download className="mr-1.5 size-3.5" aria-hidden /> Export
          </Button>
        }
      />
      <ScrollTabs
        value={tab}
        onChange={(v) => {
          setTab(v as Tab);
          setPage(1);
        }}
        tabs={[
          { id: "all", label: "All" },
          { id: "subscribed", label: "Subscribed" },
          { id: "unsubscribed", label: "Unsubscribed" },
        ]}
      />
      <PageSection>
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Search leads" placeholder="Search email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" />
            <SimpleSelect ariaLabel="Source" className="w-full md:w-auto md:min-w-44" value={source} options={sourceOptions} onChange={(v) => { setSource(v); setPage(1); }} />
          </div>
          <DataTable
            columns={columns}
            rows={list.data?.items ?? []}
            getRowId={(r) => r.id}
            isLoading={list.isLoading}
            isFetching={list.isFetching}
            error={list.isError ? { message: errorMessage(list.error), onRetry: () => void list.refetch() } : null}
            empty={
              <div className="grid justify-items-center gap-1">
                <p className="text-sm font-medium text-foreground">No leads yet</p>
                <p className="text-muted-foreground">Sign-ups from your footer and blog newsletter forms appear here.</p>
              </div>
            }
            rowActions={(r) =>
              r.status === "subscribed" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${r.email}`} />}>
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={unsub.isPending} onClick={() => unsub.mutate({ id: r.id })}>
                      <MailX /> Unsubscribe
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null
            }
            renderCard={(r) => (
              <div className="grid gap-1 p-3">
                <span className="font-medium text-foreground">{r.email}</span>
                <span className="text-muted-foreground">{sourceLabel(r.source)} · {r.status}</span>
              </div>
            )}
          />
          <Pagination page={page} pageSize={size} total={list.data?.total ?? 0} disabled={list.isFetching} onPageChange={setPage} onPageSizeChange={(n) => { setSize(n); setPage(1); }} />
        </div>
      </PageSection>
    </PageContainer>
  );
}
export default LeadsPage;
