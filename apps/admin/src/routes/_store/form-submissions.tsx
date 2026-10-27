import { createFileRoute } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Eye, MailOpen, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ConfirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input, PageContainer, PageHeader, PageSection, PageSkeleton, ScrollTabs, TableSkeleton, toast } from "@bs/ui";
import { DataTable, type Column } from "../../components/data-table/data-table.tsx";
import { Pagination } from "../../components/data-table/pagination.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";
import type { client } from "../../lib/orpc.ts";

type Row = Awaited<ReturnType<typeof client.admin.forms.list>>["items"][number];
type Tab = "inbox" | "archived";

export const Route = createFileRoute("/_store/form-submissions")({
  pendingComponent: () => (
    <PageSkeleton>
      <TableSkeleton rows={8} columns={5} />
    </PageSkeleton>
  ),
  component: FormSubmissionsPage,
});

function FormSubmissionsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("inbox");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [open, setOpen] = useState<Row | null>(null);
  const [toDelete, setToDelete] = useState<Row | null>(null);

  const list = useQuery({
    ...orpc.admin.forms.list.queryOptions({ input: { ...(tab === "archived" ? { status: "archived" as const } : {}), ...(search.trim() ? { search: search.trim() } : {}), limit: size, offset: (page - 1) * size } }),
    placeholderData: keepPreviousData,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.forms.key() });
  const setStatus = useMutation(orpc.admin.forms.setStatus.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) }));
  const remove = useMutation(
    orpc.admin.forms.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Submission deleted.");
        setToDelete(null);
        refresh();
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
  );

  const view = (r: Row) => {
    setOpen(r);
    if (r.status === "new") setStatus.mutate({ ids: [r.id], status: "read" });
  };

  const columns: Column<Row>[] = [
    { id: "from", header: "From", cell: (r) => (
      <div className="grid">
        <span className="font-medium text-foreground">{r.name}</span>
        <span className="text-muted-foreground">{r.email}</span>
      </div>
    ) },
    { id: "message", header: "Message", className: "max-w-md text-muted-foreground", cell: (r) => <span className="line-clamp-2">{r.choice ? `[${r.choice}] ` : ""}{r.message ?? "—"}</span> },
    { id: "form", header: "Form", optional: true, className: "text-muted-foreground", cell: (r) => r.formName },
    { id: "date", header: "Received", className: "whitespace-nowrap text-muted-foreground", cell: (r) => new Date(r.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) },
    { id: "status", header: "Status", cell: (r) => (r.status === "new" ? <Badge>New</Badge> : <Badge variant="secondary">{r.status === "read" ? "Read" : "Archived"}</Badge>) },
  ];

  const rowMenu = (r: Row) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${r.name}`} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onClick={() => view(r)}>
          <Eye /> Open
        </DropdownMenuItem>
        {r.status === "new" ? (
          <DropdownMenuItem onClick={() => setStatus.mutate({ ids: [r.id], status: "read" })}>
            <MailOpen /> Mark as read
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => setStatus.mutate({ ids: [r.id], status: r.status === "archived" ? "read" : "archived" })}>
          {r.status === "archived" ? <ArchiveRestore /> : <Archive />} {r.status === "archived" ? "Restore" : "Archive"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => setToDelete(r)}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <PageContainer size="full">
      <PageHeader title="Form submissions" description={`Messages sent from the contact forms on your store.${list.data?.unread ? ` ${list.data.unread} new.` : ""}`} />
      <ScrollTabs
        value={tab}
        onChange={(v) => {
          setTab(v as Tab);
          setPage(1);
        }}
        tabs={[
          { id: "inbox", label: "Inbox" },
          { id: "archived", label: "Archived" },
        ]}
      />
      <PageSection>
        <div className="grid gap-3">
          <Input aria-label="Search submissions" placeholder="Search name, email or message" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" />
          <DataTable
            columns={columns}
            rows={list.data?.items ?? []}
            getRowId={(r) => r.id}
            isLoading={list.isLoading}
            isFetching={list.isFetching}
            error={list.isError ? { message: errorMessage(list.error), onRetry: () => void list.refetch() } : null}
            empty={
              <div className="grid justify-items-center gap-1">
                <p className="text-sm font-medium text-foreground">{tab === "archived" ? "Nothing archived" : "No submissions yet"}</p>
                <p className="text-muted-foreground">Add a Contact form block to a page in the theme builder to start receiving messages.</p>
              </div>
            }
            onRowClick={view}
            rowActions={rowMenu}
            renderCard={(r) => (
              <button type="button" className="grid w-full gap-1 p-3 text-left" onClick={() => view(r)}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{r.name}</span>
                  {r.status === "new" ? <Badge>New</Badge> : null}
                </span>
                <span className="text-muted-foreground">{r.email}</span>
                <span className="line-clamp-2 text-muted-foreground">{r.message ?? ""}</span>
              </button>
            )}
          />
          <Pagination page={page} pageSize={size} total={list.data?.total ?? 0} disabled={list.isFetching} onPageChange={setPage} onPageSizeChange={(n) => { setSize(n); setPage(1); }} />
        </div>
      </PageSection>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{open?.name}</DialogTitle>
          </DialogHeader>
          {open ? (
            <div className="grid gap-2 text-sm">
              <p>
                <a className="underline" href={`mailto:${open.email}`}>{open.email}</a>
                {open.phone ? <> · <a className="underline" href={`tel:${open.phone}`}>{open.phone}</a></> : null}
              </p>
              {open.choice ? <p className="text-muted-foreground">Topic: {open.choice}</p> : null}
              <p className="whitespace-pre-wrap rounded-md bg-muted p-3">{open.message || "No message."}</p>
              <p className="text-xs text-muted-foreground">
                {open.formName} · {new Date(open.createdAt).toLocaleString("en-IN")}
                {open.recipientEmail ? ` · set to go to ${open.recipientEmail}` : ""}
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this submission?"
        description="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onConfirm={() => toDelete && remove.mutate({ ids: [toDelete.id] })}
      />
    </PageContainer>
  );
}
export default FormSubmissionsPage;
