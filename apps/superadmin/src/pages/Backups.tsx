import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, Plus, RefreshCw } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  InfoTip,
  Input,
  Label,
  PageContainer,
  PageHeader,
  PageSkeleton,
  RelativeTime,
  SimpleSelect,
  StatusBadge,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
  type StatusTone,
} from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";
import { useHasRole } from "../lib/user-context.tsx";

type Overview = Awaited<ReturnType<typeof client.backups.overview>>;
type Latest = Overview["latest"][number];

const KIND_TITLE = { dump: "Daily database dump", wal: "WAL archiving (point-in-time recovery)", drill: "Restore drill" } as const;
const STATE_LABEL: Record<string, string> = {
  fresh: "Fresh",
  stale: "Stale",
  too_small: "Suspiciously small",
  none_found: "No dump found",
  unreadable: "Bucket unreadable",
  not_expected: "Not enabled yet",
  healthy: "Healthy",
  lagging: "Lagging",
  failing: "Archiver failing",
  never_archived: "Nothing archived",
  current: "Current",
  overdue: "Overdue",
  never_drilled: "Never drilled",
};
const CONFIG_TONE: Record<string, StatusTone> = { ok: "success", warn: "warning", todo: "destructive" };
const CONFIG_LABEL: Record<string, string> = { ok: "Good", warn: "Review", todo: "To do" };

const fmtBytes = (n: unknown) => (typeof n === "number" ? (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : "unknown");
const fmtDuration = (s: number | null) => (s === null ? "not recorded" : s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

function StatusCard({ kind, latest, walExpected }: { kind: Latest["kind"]; latest: Latest | undefined; walExpected: boolean }) {
  const state = String(latest?.detail.state ?? "");
  const neutral = !latest || (kind === "wal" && !walExpected);
  const tone: StatusTone = !latest ? "neutral" : neutral ? "neutral" : latest.ok ? "success" : "destructive";
  const d = latest?.detail ?? {};
  const facts: Array<[string, string]> = [];
  if (kind === "dump" && latest) {
    if (typeof d.ageHours === "number") facts.push(["Newest dump", `${d.ageHours} h old`]);
    facts.push(["Size", fmtBytes(d.sizeBytes)]);
    if (typeof d.count === "number") facts.push(["Copies kept", String(d.count)]);
  }
  if (kind === "wal" && latest) {
    if (typeof d.lagMinutes === "number") facts.push(["Last archived", `${d.lagMinutes} min ago`]);
    if (typeof d.archivedCount === "number") facts.push(["Segments archived", String(d.archivedCount)]);
    if (typeof d.failedCount === "number" && d.failedCount > 0) facts.push(["Failures", String(d.failedCount)]);
  }
  if (kind === "drill" && latest && typeof d.ageDays === "number") facts.push(["Last passing drill", `${d.ageDays} days ago`]);
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{KIND_TITLE[kind]}</h3>
        <StatusBadge tone={tone} withDot>
          {latest ? (STATE_LABEL[state] ?? (latest.ok ? "Healthy" : "Needs attention")) : "No data yet"}
        </StatusBadge>
      </div>
      <dl className="mt-3 space-y-1 text-xs">
        {facts.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium text-foreground">{v}</dd>
          </div>
        ))}
        {latest && (
          <div className="flex justify-between gap-2 pt-1">
            <dt className="text-muted-foreground">Checked</dt>
            <dd className="text-foreground">
              <RelativeTime date={latest.checkedAt} />
            </dd>
          </div>
        )}
        {!latest && <p className="text-muted-foreground">The worker has not reported this check yet.</p>}
      </dl>
    </div>
  );
}

function AlertPolicy({ settings, canEdit }: { settings: Overview["settings"]; canEdit: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    dumpMaxAgeHours: String(settings.dumpMaxAgeHours),
    walMaxLagMinutes: String(settings.walMaxLagMinutes),
    drillEveryDays: String(settings.drillEveryDays),
    walArchivingExpected: settings.walArchivingExpected,
    alertEmails: settings.alertEmails.join(", "),
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await client.backups.updateSettings({
        dumpMaxAgeHours: Number(form.dumpMaxAgeHours),
        walMaxLagMinutes: Number(form.walMaxLagMinutes),
        drillEveryDays: Number(form.drillEveryDays),
        walArchivingExpected: form.walArchivingExpected,
        alertEmails: form.alertEmails.split(/[,;\n]/).map((e) => e.trim()).filter(Boolean),
      });
      toast.success("Backup alert settings saved");
      await qc.invalidateQueries({ queryKey: ["platform", "backups"] });
    } catch (err) {
      toast.error(messageOf(err, "Could not save the settings"));
    } finally {
      setSaving(false);
    }
  };

  return (
        <section className="rounded-xl border border-border bg-card p-5 shadow-xs">
          <div className="mb-4 flex items-center gap-2">
            <DatabaseBackup className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Alert policy</h2>
            <InfoTip>Changes when an alert fires and who gets the email. It does not change how backups are taken. Alerts also use a Better Stack heartbeat, which keeps working if email is down.</InfoTip>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="dumpAge">Alert if newest dump is older than (hours)</Label>
              <Input id="dumpAge" type="number" min={1} max={168} value={form.dumpMaxAgeHours} disabled={!canEdit} onChange={(e) => setForm({ ...form, dumpMaxAgeHours: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="walLag">Alert if WAL archiving lags more than (minutes)</Label>
              <Input id="walLag" type="number" min={1} max={1440} value={form.walMaxLagMinutes} disabled={!canEdit} onChange={(e) => setForm({ ...form, walMaxLagMinutes: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drillDays">Restore drill needed every (days)</Label>
              <Input id="drillDays" type="number" min={7} max={120} value={form.drillEveryDays} disabled={!canEdit} onChange={(e) => setForm({ ...form, drillEveryDays: e.target.value })} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Switch id="walExpected" checked={form.walArchivingExpected} disabled={!canEdit} onCheckedChange={(v) => setForm({ ...form, walArchivingExpected: v })} />
            <Label htmlFor="walExpected" className="inline-flex items-center gap-1.5">
              WAL archiving is live, so alert when it goes quiet
              <InfoTip>Leave off until the pgBackRest cutover is done. Turning it on earlier would raise a false alert.</InfoTip>
            </Label>
          </div>
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="emails">Alert email addresses (up to 5, comma separated)</Label>
            <Textarea id="emails" rows={2} value={form.alertEmails} disabled={!canEdit} onChange={(e) => setForm({ ...form, alertEmails: e.target.value })} placeholder="admin@example.com" />
          </div>
          {canEdit ? (
            <div className="mt-4 flex justify-end">
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? "Saving..." : "Save alert policy"}
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Only platform admins can change this.</p>
          )}
        </section>

  );
}

export function Backups() {
  const canEdit = useHasRole("platform_admin");
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ["platform", "backups"], queryFn: () => client.backups.overview(), refetchInterval: 60_000 });

  const [drillOpen, setDrillOpen] = useState(false);
  const [drill, setDrill] = useState({ kind: "dump", result: "pass", drilledAt: "", rtoMinutes: "", rpoMinutes: "", notes: "" });
  const [drillSaving, setDrillSaving] = useState(false);

  if (isLoading || !data) return <PageSkeleton />;
  const latestOf = (k: Latest["kind"]) => data.latest.find((l) => l.kind === k);
  const failing = data.latest.filter((l) => !l.ok);

  const saveDrill = async () => {
    setDrillSaving(true);
    try {
      await client.backups.recordDrill({
        kind: drill.kind as "dump" | "pitr" | "tenant" | "rebuild",
        result: drill.result as "pass" | "fail",
        drilledAt: new Date(drill.drilledAt || Date.now()).toISOString(),
        ...(drill.rtoMinutes ? { rtoSeconds: Math.round(Number(drill.rtoMinutes) * 60) } : {}),
        ...(drill.rpoMinutes ? { rpoSeconds: Math.round(Number(drill.rpoMinutes) * 60) } : {}),
        ...(drill.notes.trim() ? { notes: drill.notes.trim() } : {}),
      });
      toast.success("Restore drill recorded");
      setDrillOpen(false);
      setDrill({ kind: "dump", result: "pass", drilledAt: "", rtoMinutes: "", rpoMinutes: "", notes: "" });
      await qc.invalidateQueries({ queryKey: ["platform", "backups"] });
    } catch (err) {
      toast.error(messageOf(err, "Could not record the drill"));
    } finally {
      setDrillSaving(false);
    }
  };

  return (
    <PageContainer size="full">
      <PageHeader
        title="Backups & recovery"
        description="Is the database backed up, can it be restored, and who is told when it is not. Backup schedule and WAL settings are changed in Coolify and Postgres, then checked here."
        aside={
          <Button size="sm" variant="default" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      <div className="space-y-8">
        {data.monitoring === "never_ran" && (
          <Alert>
            <AlertTitle>Backup monitoring has not reported yet</AlertTitle>
            <AlertDescription>
              The worker checks the backup bucket every 30 minutes. It stays silent until the read-only backup credentials (BACKUP_R2_*) are set on the worker service. Until then these cards show no data and no alerts are sent.
            </AlertDescription>
          </Alert>
        )}
        {failing.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>{failing.length === 1 ? "A backup check needs attention" : `${failing.length} backup checks need attention`}</AlertTitle>
            <AlertDescription>{failing.map((f) => KIND_TITLE[f.kind]).join(", ")}. Follow infra/runbooks/INCIDENT.md and infra/backups/RESTORE-DRILL.md.</AlertDescription>
          </Alert>
        )}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatusCard kind="dump" latest={latestOf("dump")} walExpected={data.settings.walArchivingExpected} />
          <StatusCard kind="wal" latest={latestOf("wal")} walExpected={data.settings.walArchivingExpected} />
          <StatusCard kind="drill" latest={latestOf("drill")} walExpected={data.settings.walArchivingExpected} />
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Best-practice check</h2>
            <InfoTip>Read from the live database and the alert policy. To change archive_mode, archive_timeout or the dump schedule, follow the pgBackRest steps in infra/backups/README.md and the Coolify steps in infra/coolify/RUNBOOK.md section 8. Those settings are not editable from here on purpose: they need a restart or a Coolify credential this app does not hold.</InfoTip>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="px-4">Setting</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Recommended</TableHead>
                  <TableHead className="px-4 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.config.map((c) => (
                  <TableRow key={c.key}>
                    <TableCell className="px-4 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {c.label}
                        <InfoTip>{c.note}</InfoTip>
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.current}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.recommended}</TableCell>
                    <TableCell className="px-4 text-right">
                      <StatusBadge tone={CONFIG_TONE[c.status] ?? "neutral"}>{CONFIG_LABEL[c.status] ?? c.status}</StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <AlertPolicy key={data.settings.updatedAt} settings={data.settings} canEdit={canEdit} />

        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Restore drill log</h2>
              <InfoTip>A backup only counts once a restore has been proven. Run infra/backups/RESTORE-DRILL.md, then record the result here with the measured recovery time (RTO) and data-loss window (RPO).</InfoTip>
            </div>
            {canEdit && (
              <Button size="sm" onClick={() => setDrillOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Record drill
              </Button>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="px-4">Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>RTO</TableHead>
                  <TableHead>RPO</TableHead>
                  <TableHead className="px-4">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.drills.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No restore drill has been recorded yet. This is the most important gap: an untested backup may not restore.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.drills.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="px-4 text-xs">{new Date(d.drilledAt).toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-xs capitalize">{d.kind === "pitr" ? "Point in time" : d.kind}</TableCell>
                      <TableCell>
                        <StatusBadge tone={d.result === "pass" ? "success" : "destructive"}>{d.result}</StatusBadge>
                      </TableCell>
                      <TableCell className="text-xs">{fmtDuration(d.rtoSeconds)}</TableCell>
                      <TableCell className="text-xs">{fmtDuration(d.rpoSeconds)}</TableCell>
                      <TableCell className="px-4 text-xs text-muted-foreground">{d.notes ?? ""}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>

      <Dialog open={drillOpen} onOpenChange={setDrillOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a restore drill</DialogTitle>
            <DialogDescription>Enter what you measured. Never paste credentials or connection strings here.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <SimpleSelect
                value={drill.kind}
                onChange={(v) => setDrill({ ...drill, kind: v })}
                options={[
                  { value: "dump", label: "Daily dump restore" },
                  { value: "pitr", label: "Point-in-time (WAL)" },
                  { value: "tenant", label: "Single store" },
                  { value: "rebuild", label: "Full server rebuild" },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Result</Label>
              <SimpleSelect value={drill.result} onChange={(v) => setDrill({ ...drill, result: v })} options={[{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }]} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="drillAt">When it was run</Label>
              <Input id="drillAt" type="datetime-local" value={drill.drilledAt} onChange={(e) => setDrill({ ...drill, drilledAt: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rto">Recovery time, RTO (minutes)</Label>
              <Input id="rto" type="number" min={0} value={drill.rtoMinutes} onChange={(e) => setDrill({ ...drill, rtoMinutes: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rpo">Data-loss window, RPO (minutes)</Label>
              <Input id="rpo" type="number" min={0} value={drill.rpoMinutes} onChange={(e) => setDrill({ ...drill, rpoMinutes: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" rows={3} value={drill.notes} onChange={(e) => setDrill({ ...drill, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDrillOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveDrill()} disabled={drillSaving}>
              {drillSaving ? "Saving..." : "Record drill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
