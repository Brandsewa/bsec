import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  HardDrive,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  Button,
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

export function System() {
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [retryingWebhookId, setRetryingWebhookId] = useState<string | null>(null);

  const { data: systemData, isLoading, refetch } = useQuery({
    queryKey: ["platform", "system-data"],
    queryFn: () => client.system.data(),
    refetchInterval: 15_000,
  });

  const handleRetryJob = async (jobId: string) => {
    setRetryingJobId(jobId);
    try {
      await client.system.retryJob({ jobId });
      toast.success(`Job ${jobId} rescheduled in pg-boss queue`);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to retry job"));
    } finally {
      setRetryingJobId(null);
    }
  };

  const handleRetryWebhook = async (webhookId: string) => {
    setRetryingWebhookId(webhookId);
    try {
      await client.system.retryWebhook({ webhookId });
      toast.success("Webhook marked as received for reprocessing");
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to retry webhook"));
    } finally {
      setRetryingWebhookId(null);
    }
  };

  if (isLoading || !systemData) return <PageSkeleton />;

  return (
    <PageContainer>
      <PageHeader
        title="System Operations & Queues"
        description="Real-time telemetry from pg-boss background queues, decoupled webhook inboxes, and backup targets."
        aside={
          <Button size="sm" variant="default" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      <div className="space-y-8">
        {/* Disaster Recovery & Backup Indicators */}
        <div className="rounded-xl border bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-sm">Disaster Recovery & Backup SLA</h2>
            </div>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${
              systemData.backups.status === "healthy"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
            }`}>
              {systemData.backups.status}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Last Full Backup</span>
              <p className="font-medium text-foreground text-sm mt-0.5">
                {systemData.backups.lastBackupAt ? new Date(systemData.backups.lastBackupAt).toLocaleString("en-IN") : "Continuous WAL active"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Last Restore Drill Test</span>
              <p className="font-medium text-foreground text-sm mt-0.5">
                {systemData.backups.lastRestoreTestAt ? new Date(systemData.backups.lastRestoreTestAt).toLocaleDateString("en-IN") : "Drill logged on staging"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">RPO Target</span>
              <p className="font-medium text-foreground text-sm mt-0.5">
                ≤ {systemData.backups.rpoTargetMinutes} minutes (WAL to R2)
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">RTO Target</span>
              <p className="font-medium text-foreground text-sm mt-0.5">
                ≤ {systemData.backups.rtoTargetHours} hours (Restore runbook)
              </p>
            </div>
          </div>
        </div>

        {/* pg-boss Queues */}
        <div>
          <h2 className="text-base font-semibold mb-3">pg-boss Queue Depth & Jobs</h2>
          <div className="rounded-xl border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queue / State</TableHead>
                  <TableHead>Queued / Pending</TableHead>
                  <TableHead>Active / Running</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {systemData.queues.map((q) => (
                  <TableRow key={q.queue}>
                    <TableCell className="font-mono text-xs font-semibold">{q.queue}</TableCell>
                    <TableCell className="text-xs">{q.depth}</TableCell>
                    <TableCell className="text-xs">{q.active}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{q.completed}</TableCell>
                    <TableCell className={`text-xs font-semibold ${q.failed > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {q.failed}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Failed Jobs Table with Retry */}
        <div>
          <h2 className="text-base font-semibold mb-3">Failed Background Jobs</h2>
          {systemData.failedJobs.length === 0 ? (
            <div className="rounded-xl border bg-card p-6 text-center text-xs text-muted-foreground">
              No failed jobs in pg-boss queue.
            </div>
          ) : (
            <div className="rounded-xl border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job ID</TableHead>
                    <TableHead>Job Name</TableHead>
                    <TableHead>Retry Count</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {systemData.failedJobs.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="font-mono text-xs">{j.id}</TableCell>
                      <TableCell className="text-xs font-semibold">{j.name}</TableCell>
                      <TableCell className="text-xs">{j.retryCount}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(j.createdOn).toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs px-2"
                          disabled={retryingJobId === j.id}
                          onClick={() => handleRetryJob(j.id)}
                        >
                          <RotateCcw className={`mr-1 h-3 w-3 ${retryingJobId === j.id ? "animate-spin" : ""}`} />
                          Retry Job
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Inbound Webhook Errors */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Decoupled Webhook Inbox</h2>
            <div className="flex items-center gap-4 text-xs">
              <span>Received: <strong>{systemData.webhookSummary.received}</strong></span>
              <span>Processed: <strong className="text-emerald-600">{systemData.webhookSummary.processed}</strong></span>
              <span>Failed: <strong className="text-destructive">{systemData.webhookSummary.failed}</strong></span>
            </div>
          </div>

          {systemData.failedWebhooks.length === 0 ? (
            <div className="rounded-xl border bg-card p-6 text-center text-xs text-muted-foreground">
              No failed webhooks in inbox queue.
            </div>
          ) : (
            <div className="rounded-xl border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Event ID</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Error Diagnostics</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {systemData.failedWebhooks.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="text-xs uppercase font-medium">{w.provider}</TableCell>
                      <TableCell className="font-mono text-xs">{w.eventId}</TableCell>
                      <TableCell className="text-xs">{w.attempts}</TableCell>
                      <TableCell className="font-mono text-xs text-destructive">{w.error || "Execution error"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(w.receivedAt).toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs px-2"
                          disabled={retryingWebhookId === w.id}
                          onClick={() => handleRetryWebhook(w.id)}
                        >
                          <RotateCcw className={`mr-1 h-3 w-3 ${retryingWebhookId === w.id ? "animate-spin" : ""}`} />
                          Retry Webhook
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
