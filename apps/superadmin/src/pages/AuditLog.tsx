import React, { useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Copy, Download, FileSpreadsheet } from "lucide-react";
import {
  Button,
  Checkbox,
  EmptyState,
  Input,
  PageContainer,
  PageHeader,
  PageSkeleton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SimpleSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@bs/ui";
import type { PlatformAuditLog } from "@bs/contracts";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";
import { useHasRole } from "../lib/user-context.tsx";

const PAGE_SIZES = [25, 50, 100];

/** Replaces values of keys that look like secrets, so a copied entry is safe to paste into a ticket. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = /secret|token|password|passwd|authorization|api[-_]?key|private[-_]?key/i.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

/** CSV cell with formula-injection protection (values starting with = + - @ are prefixed with a quote). */
function csvCell(v: unknown): string {
  let t = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
}

function downloadCsv(name: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", name);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function rowsToCsv(rows: PlatformAuditLog[]): string {
  const headers = ["ID", "Timestamp", "Actor Email", "Actor Type", "Action", "Target Type", "Target ID", "Tenant ID", "IP", "Request ID", "Diff"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.createdAt,
        r.actorEmail ?? r.actorUserId ?? "",
        r.actorType,
        r.action,
        r.targetType,
        r.targetId,
        r.tenantId ?? "",
        r.ip ?? "",
        r.requestId ?? "",
        r.diff ? JSON.stringify(redact(r.diff)) : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function AuditLog() {
  const queryClient = useQueryClient();
  const canArchive = useHasRole("platform_admin");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [view, setView] = useState<"hide" | "only">("hide");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Map<string, PlatformAuditLog>>(new Map());
  const [detail, setDetail] = useState<PlatformAuditLog | null>(null);
  const [busy, setBusy] = useState(false);

  const filterKey = `${search}|${from}|${to}|${view}|${pageSize}`;
  const [seenKey, setSeenKey] = useState(filterKey);
  if (seenKey !== filterKey) {
    // A different result set: go back to the first page and drop the selection.
    setSeenKey(filterKey);
    setPage(0);
    setSelected(new Map());
  }

  const params = useMemo(
    () => ({
      actionContains: search.trim() || undefined,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      // Inclusive end date: the day after, exclusive.
      to: to ? new Date(new Date(`${to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000).toISOString() : undefined,
      archived: view,
    }),
    [search, from, to, view],
  );

  // One extra row tells us whether a next page exists without a separate count query.
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["platform", "audit-logs", params, page, pageSize],
    queryFn: () => client.audit.list({ ...params, limit: pageSize + 1, offset: page * pageSize }),
    placeholderData: keepPreviousData,
  });

  const rows = (data ?? []).slice(0, pageSize);
  const hasNext = (data?.length ?? 0) > pageSize;
  const pageFullySelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleRow(row: PlatformAuditLog, on: boolean) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) next.set(row.id, row);
      else next.delete(row.id);
      return next;
    });
  }
  function togglePage(on: boolean) {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const r of rows) {
        if (on) next.set(r.id, r);
        else next.delete(r.id);
      }
      return next;
    });
  }

  async function exportAll() {
    setBusy(true);
    try {
      const res = await client.audit.exportCsv({ action: undefined });
      downloadCsv(`platform-audit-${new Date().toISOString().slice(0, 10)}.csv`, res.csv);
      toast.success("Audit log CSV exported");
    } catch (err) {
      toast.error(messageOf(err, "Failed to export audit CSV"));
    } finally {
      setBusy(false);
    }
  }

  function exportSelected() {
    downloadCsv(`platform-audit-selection-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv([...selected.values()]));
    toast.success(`${selected.size} entr${selected.size === 1 ? "y" : "ies"} exported`);
  }

  async function runArchive(archive: boolean) {
    const ids = [...selected.keys()];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      if (archive) {
        const r = await client.audit.archive({ ids });
        toast.success(`${r.archived} entr${r.archived === 1 ? "y" : "ies"} archived`);
      } else {
        const r = await client.audit.unarchive({ ids });
        toast.success(`${r.unarchived} entr${r.unarchived === 1 ? "y" : "ies"} restored to the main view`);
      }
      setSelected(new Map());
      void queryClient.invalidateQueries({ queryKey: ["platform", "audit-logs"] });
    } catch (err) {
      toast.error(messageOf(err, archive ? "Failed to archive entries" : "Failed to restore entries"));
    } finally {
      setBusy(false);
    }
  }

  async function copyDetail(log: PlatformAuditLog) {
    const safe = redact(log);
    try {
      await navigator.clipboard.writeText(JSON.stringify(safe, null, 2));
      toast.success("Entry copied as JSON (secret-looking values redacted)");
    } catch {
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  }

  if (isLoading) return <PageSkeleton />;

  const filtersActive = Boolean(search.trim() || from || to || view !== "hide");

  return (
    <PageContainer size="full">
      <PageHeader
        title="Platform Audit Log"
        description="Append-only record of every privileged action. Entries are never deleted: archive hides them from the main view, and everything stays exportable."
        aside={
          <Button size="sm" variant="default" onClick={() => void exportAll()} disabled={busy}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {busy ? "Working..." : "Export all CSV"}
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <label htmlFor="audit-search" className="mb-1 block text-[11px] font-medium text-muted-foreground">Action contains</label>
          <Input id="audit-search" placeholder="e.g. tenant.suspend" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 text-xs" />
        </div>
        <div>
          <label htmlFor="audit-from" className="mb-1 block text-[11px] font-medium text-muted-foreground">From</label>
          <Input id="audit-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9 text-xs" />
        </div>
        <div>
          <label htmlFor="audit-to" className="mb-1 block text-[11px] font-medium text-muted-foreground">To</label>
          <Input id="audit-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 text-xs" />
        </div>
        <div className="w-40">
          <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Show</span>
          <SimpleSelect
            ariaLabel="Archive filter"
            value={view}
            onChange={(v) => setView(v as "hide" | "only")}
            options={[
              { value: "hide", label: "Active entries" },
              { value: "only", label: "Archived only" },
            ]}
          />
        </div>
        {filtersActive ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setFrom("");
              setTo("");
              setView("hide");
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {selected.size > 0 ? (
        <div role="region" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs">
          <span className="font-medium text-foreground">{selected.size} selected</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={exportSelected}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export selection
          </Button>
          {canArchive ? (
            view === "hide" ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void runArchive(true)}>
                <Archive className="mr-1.5 h-3.5 w-3.5" /> Archive
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void runArchive(false)}>
                <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" /> Restore to main view
              </Button>
            )
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>
            Clear
          </Button>
          <span className="text-muted-foreground">Audit entries are never deleted.</span>
        </div>
      ) : null}

      {isError ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="Could not load the audit log"
          description={messageOf(error, "Try again in a moment.")}
          action={<Button onClick={() => void refetch()}>Try again</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No audit entries found"
          description={filtersActive ? "Try changing or clearing the filters." : "Privileged mutations executed through the platform API will appear here."}
        />
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-10 px-4">
                  <Checkbox
                    aria-label="Select all entries on this page"
                    checked={pageFullySelected}
                    onCheckedChange={(c) => togglePage(Boolean(c))}
                  />
                </TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target Entity</TableHead>
                <TableHead>Store Tenant</TableHead>
                <TableHead className="text-right px-4">IP Address</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={isFetching ? "opacity-70 transition-opacity" : undefined}>
              {rows.map((log) => (
                <TableRow
                  key={log.id}
                  className="cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setDetail(log)}
                >
                  <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select entry ${log.action}`}
                      checked={selected.has(log.id)}
                      onCheckedChange={(c) => toggleRow(log, Boolean(c))}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="font-mono text-xs font-semibold text-foreground">
                    {log.action}
                    {log.archived ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">archived</span> : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="font-medium text-foreground">{log.actorEmail ?? log.actorType}</span>
                    {log.actorUserId && (
                      <div className="text-muted-foreground text-[10px] font-mono">{log.actorUserId.substring(0, 8)}...</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    <span className="text-muted-foreground">{log.targetType}:</span> {log.targetId.substring(0, 10)}...
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {log.tenantId ? `${log.tenantId.substring(0, 8)}...` : "—"}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground text-right px-4">{log.ip || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <div className="w-20">
                <SimpleSelect
                  ariaLabel="Rows per page"
                  value={String(pageSize)}
                  onChange={(v) => setPageSize(Number(v))}
                  options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span>
                {page * pageSize + 1}-{page * pageSize + rows.length}
              </span>
              <Button size="sm" variant="outline" disabled={page === 0 || isFetching} onClick={() => setPage((p) => Math.max(0, p - 1))} aria-label="Previous page">
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button size="sm" variant="outline" disabled={!hasNext || isFetching} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      <Sheet open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <SheetContent className="overflow-y-auto p-0">
          {detail ? (
            <>
              <SheetHeader className="border-b border-border p-5 sm:p-8">
                <SheetTitle className="font-mono text-sm">{detail.action}</SheetTitle>
                <SheetDescription>{new Date(detail.createdAt).toLocaleString("en-IN")}</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 p-5 text-xs sm:p-8">
                <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2">
                  <DetailRow label="Entry ID" value={detail.id} mono />
                  <DetailRow label="Actor" value={detail.actorEmail ?? detail.actorType} />
                  <DetailRow label="Actor type" value={detail.actorType} />
                  <DetailRow label="Actor user ID" value={detail.actorUserId} mono />
                  <DetailRow label="Target" value={`${detail.targetType}: ${detail.targetId}`} mono />
                  <DetailRow label="Store (tenant)" value={detail.tenantId} mono />
                  <DetailRow label="IP address" value={detail.ip} mono />
                  <DetailRow label="User agent" value={detail.userAgent} />
                  <DetailRow label="Request ID" value={detail.requestId} mono />
                  <DetailRow label="Status" value={detail.archived ? "Archived" : "Active"} />
                </dl>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-foreground">Details (before / after)</h3>
                    <Button size="sm" variant="outline" onClick={() => void copyDetail(detail)}>
                      <Copy className="mr-1.5 size-3.5" aria-hidden /> Copy as JSON
                    </Button>
                  </div>
                  <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-[11px] leading-relaxed text-foreground">
                    {detail.diff ? JSON.stringify(redact(detail.diff), null, 2) : "No extra details were recorded for this action."}
                  </pre>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">Values under keys that look like secrets are shown as [redacted].</p>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-foreground" : "break-words text-foreground"}>{value || "—"}</dd>
    </>
  );
}
