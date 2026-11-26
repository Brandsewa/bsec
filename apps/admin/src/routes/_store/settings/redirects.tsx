import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CornerDownRight, Trash2, Upload } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  PageSkeleton,
  SimpleSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
  toast,
} from "@bs/ui";
import { SettingsCard, SettingsPageFrame } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { parseRedirectsCsv } from "../../../lib/redirects-csv.ts";

export const Route = createFileRoute("/_store/settings/redirects")({
  pendingComponent: () => <PageSkeleton />,
  component: RedirectsSettingsPage,
});

const STATUS_OPTIONS = [
  { value: "308", label: "308 Permanent (recommended)" },
  { value: "301", label: "301 Permanent" },
  { value: "307", label: "307 Temporary" },
  { value: "302", label: "302 Temporary" },
];

const SOURCE_LABEL = { manual: "Added by you", import: "Imported", auto: "Automatic (address changed)" } as const;

const PAGE_SIZE = 25;

export function RedirectsSettingsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("308");
  const [deleting, setDeleting] = useState<{ id: string; from: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = useQuery({
    ...orpc.admin.redirects.list.queryOptions({ input: { search: search.trim() || undefined, page, pageSize: PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.redirects.key() });
  const create = useMutation(orpc.admin.redirects.create.mutationOptions());
  const remove = useMutation(orpc.admin.redirects.delete.mutationOptions());
  const bulk = useMutation(orpc.admin.redirects.import.mutationOptions());

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!from.trim() || !to.trim()) {
      toast.error("Enter the old address and where it should go.");
      return;
    }
    create.mutate(
      { from: from.trim(), to: to.trim(), status: Number(status) },
      {
        onSuccess: () => {
          toast.success("Redirect saved. It starts working within half a minute.");
          setFrom("");
          setTo("");
          refresh();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const parsed = parseRedirectsCsv(await file.text());
    if (parsed.rows.length === 0) {
      toast.error(parsed.error ?? "That file has no redirects in it.");
      return;
    }
    if (parsed.rows.length > 500) {
      toast.error("Upload up to 500 redirects at a time. Split the file and upload the parts one after another.");
      return;
    }
    bulk.mutate(
      { rows: parsed.rows },
      {
        onSuccess: (res) => {
          const firstProblem = res.results.find((r) => !r.ok);
          if (res.skipped === 0) toast.success(`${res.created} redirects added.`);
          else toast.info(`${res.created} added, ${res.skipped} skipped. Row ${firstProblem?.row}: ${firstProblem?.message ?? "could not be imported"}`);
          refresh();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  return (
    <SettingsPageFrame
      title="Redirects"
      description="Keep an old address working. Visitors and search engines who use the old address are sent to the new one. Useful after moving from another platform or renaming a page."
    >
      <SettingsCard title="Add a redirect" description="Use a path such as /old-page. The destination can be a path on your store or a full https:// address.">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_1fr_14rem_auto] sm:items-end">
          <Field label="Old address">
            <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="/blogs/news/old-post" maxLength={600} />
          </Field>
          <Field label="Send visitors to">
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="/blog/new-post" maxLength={2000} />
          </Field>
          <Field label="Type">
            <SimpleSelect ariaLabel="Redirect type" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
          </Field>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Add"}
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4 text-sm text-muted-foreground">
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={bulk.isPending}>
            <Upload className="size-4" aria-hidden /> {bulk.isPending ? "Importing…" : "Upload a CSV"}
          </Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="sr-only" aria-label="Upload a CSV of redirects" onChange={(e) => void onFile(e)} />
          <span>Two columns: old address, new address. An optional third column sets the type (301, 302, 307 or 308). Up to 500 rows at a time.</span>
        </div>
      </SettingsCard>

      <SettingsCard title="Your redirects" description={list.data ? `${total} of up to ${list.data.limit}.` : undefined}>
        <div className="mb-4 max-w-sm">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search old or new address"
            aria-label="Search redirects"
          />
        </div>
        {list.isLoading ? (
          <TableSkeleton rows={5} columns={4} />
        ) : list.isError ? (
          <EmptyState icon={AlertTriangle} title="Could not load redirects" description={errorMessage(list.error)} action={<Button onClick={() => void list.refetch()}>Try again</Button>} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={CornerDownRight}
            title={search.trim() ? "No redirects match" : "No redirects yet"}
            description={search.trim() ? "Try a different search." : "When you change the address of a product, collection or category, we add a redirect for the old one automatically."}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Old address</TableHead>
                  <TableHead>Goes to</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[18rem] break-all font-mono text-xs">{r.fromPath}</TableCell>
                    <TableCell className="max-w-[18rem] break-all font-mono text-xs">
                      <ArrowRight className="mr-1 inline size-3 text-muted-foreground" aria-hidden />
                      {r.toPath}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.statusCode}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{SOURCE_LABEL[r.source]}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" aria-label={`Delete redirect from ${r.fromPath}`} onClick={() => setDeleting({ id: r.id, from: r.fromPath })}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pages > 1 ? (
              <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Page {page} of {pages}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </SettingsCard>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this redirect?"
        description={deleting ? `${deleting.from} will stop redirecting and show "page not found" again.` : ""}
        confirmLabel="Delete redirect"
        destructive
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(
            { id: deleting.id },
            {
              onSuccess: () => {
                toast.success("Redirect deleted.");
                setDeleting(null);
                refresh();
              },
              onError: (err) => toast.error(errorMessage(err)),
            },
          );
        }}
      />
    </SettingsPageFrame>
  );
}
