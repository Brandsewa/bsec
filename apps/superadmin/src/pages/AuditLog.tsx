import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Download, } from "lucide-react";
import {
  Button,
  EmptyState,
  Input,
  PageContainer,
  PageHeader,
  PageSkeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";

export function AuditLog() {
  const [actionFilter, setActionFilter] = useState("");
  const [downloading, setDownloading] = useState(false);

  const { data: auditLogs, isLoading } = useQuery({
    queryKey: ["platform", "audit-logs", { action: actionFilter }],
    queryFn: () => client.audit.list({ action: actionFilter.trim() || undefined, limit: 100 }),
  });

  const handleExportCsv = async () => {
    setDownloading(true);
    try {
      const res = await client.audit.exportCsv({ action: actionFilter.trim() || undefined });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `platform-audit-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Audit log CSV exported");
    } catch (err) {
      toast.error(messageOf(err, "Failed to export audit CSV"));
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading) return <PageSkeleton />;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Platform Audit Log"
        description="Immutable record of every privileged mutation executed across stores. Filterable and exportable to CSV."
        aside={
          <Button size="sm" variant="default" onClick={handleExportCsv} disabled={downloading}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {downloading ? "Exporting..." : "Export CSV"}
          </Button>
        }
      />

      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Filter by action name (e.g. tenant.suspend, platform_staff.invite)..."
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="text-xs h-9"
        />
      </div>

      {(!auditLogs || auditLogs.length === 0) ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No audit entries found"
          description="Privileged mutations executed through the platform API will appear here."
        />
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Timestamp</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target Entity</TableHead>
                <TableHead>Store Tenant</TableHead>
                <TableHead className="text-right px-4">IP Address</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLogs.map((log) => (
                <TableRow key={log.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap px-4">
                    {new Date(log.createdAt).toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="font-mono text-xs font-semibold text-foreground">
                    {log.action}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="font-medium text-foreground">{log.actorType}</span>
                    {log.actorUserId && (
                      <div className="text-muted-foreground text-[10px] font-mono">
                        {log.actorUserId.substring(0, 8)}...
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    <span className="text-muted-foreground">{log.targetType}:</span> {log.targetId.substring(0, 10)}...
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {log.tenantId ? `${log.tenantId.substring(0, 8)}...` : "—"}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground text-right px-4">
                    {log.ip || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageContainer>
  );
}
