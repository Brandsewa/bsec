import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import {
  Button,
  ConfirmDialog,
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
import type { PlatformFeatureFlag } from "@bs/contracts";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";
import { useHasRole } from "../lib/user-context.tsx";

type FlagSection = { title: string; description: string; flags: PlatformFeatureFlag[] };

export function Features() {
  const canManage = useHasRole("platform_admin");
  const canRestore = useHasRole("platform_owner");
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [killSwitchConfirm, setKillSwitchConfirm] = useState<{
    key: string;
    currentKill: boolean;
    defaultOn: boolean;
  } | null>(null);
  const [retireConfirm, setRetireConfirm] = useState<string | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState<string | null>(null);

  const { data: flags, isLoading, refetch } = useQuery({
    queryKey: ["platform", "features"],
    queryFn: () => client.features.list(),
  });

  const handleToggle = async (key: string, currentOn: boolean) => {
    setUpdatingKey(key);
    try {
      await client.features.update({
        featureKey: key,
        defaultOn: !currentOn,
      });
      toast.success(`Flag '${key}' updated to ${!currentOn ? "enabled" : "disabled"}`);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to update feature flag"));
    } finally {
      setUpdatingKey(null);
    }
  };

  const executeKillSwitch = async (key: string, currentKill: boolean, defaultOn: boolean) => {
    setUpdatingKey(key);
    try {
      await client.features.update({
        featureKey: key,
        defaultOn,
        killSwitch: !currentKill,
      });
      toast.success(`Kill switch for '${key}' updated`);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to toggle kill switch"));
    } finally {
      setUpdatingKey(null);
      setKillSwitchConfirm(null);
    }
  };

  const executeRetire = async (key: string) => {
    setUpdatingKey(key);
    try {
      await client.features.retire({ featureKey: key });
      toast.success(`'${key}' is now permanent and hidden from this list`);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to make the feature permanent"));
    } finally {
      setUpdatingKey(null);
      setRetireConfirm(null);
    }
  };

  const executeRestore = async (key: string) => {
    setUpdatingKey(key);
    try {
      await client.features.restore({ featureKey: key });
      toast.success(`'${key}' restored as a normal release flag`);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to restore the feature flag"));
    } finally {
      setUpdatingKey(null);
      setRestoreConfirm(null);
    }
  };

  if (isLoading) return <PageSkeleton />;

  const active = (flags ?? []).filter((f) => !f.retiredAt);
  const retired = (flags ?? []).filter((f) => f.retiredAt);
  const sections: FlagSection[] = [
    {
      title: "Kill switches",
      description: "Long-lived emergency switches. These stay here on purpose and cannot be made permanent.",
      flags: active.filter((f) => f.kind === "kill_switch"),
    },
    {
      title: "Release flags",
      description: "Temporary rollout flags. Once a feature is settled, make it permanent to take it off this list.",
      flags: active.filter((f) => f.kind !== "kill_switch"),
    },
  ];

  const renderRow = (f: PlatformFeatureFlag) => {
    const isRetired = Boolean(f.retiredAt);
    const busy = updatingKey === f.key;
    return (
      <TableRow key={f.key} className="hover:bg-muted/30 transition-colors">
        <TableCell className="px-4">
          <div className="font-mono text-xs font-semibold text-foreground">{f.key}</div>
          {f.description ? <div className="mt-0.5 text-[11px] text-muted-foreground">{f.description}</div> : null}
        </TableCell>
        <TableCell>
          {isRetired ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              <Lock className="size-3" aria-hidden /> Permanent
            </span>
          ) : (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                f.defaultOn ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"
              }`}
            >
              {f.defaultOn ? "Enabled by Default" : "Disabled by Default"}
            </span>
          )}
        </TableCell>
        <TableCell>
          {isRetired ? (
            <span className="text-xs text-muted-foreground">Not applicable</span>
          ) : f.killSwitch ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-destructive/15 text-destructive uppercase tracking-wide">
              ACTIVATED
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Off (Normal operation)</span>
          )}
        </TableCell>
        <TableCell className="text-right px-4">
          <div className="flex items-center justify-end gap-2">
            {isRetired ? (
              canRestore ? (
                <Button size="sm" variant="outline" className="h-7 text-xs px-2.5" disabled={busy} onClick={() => setRestoreConfirm(f.key)}>
                  Restore
                </Button>
              ) : null
            ) : (
              <>
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs px-2.5"
                  disabled={busy || !canManage}
                  onClick={() => handleToggle(f.key, f.defaultOn)}
                >
                  {f.defaultOn ? "Turn Off" : "Turn On"}
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  className={`h-7 text-xs px-2.5 ${f.killSwitch ? "text-primary" : "text-destructive hover:bg-destructive/10"}`}
                  disabled={busy || !canManage}
                  onClick={() =>
                    setKillSwitchConfirm({
                      key: f.key,
                      currentKill: f.killSwitch,
                      defaultOn: f.defaultOn,
                    })
                  }
                >
                  {f.killSwitch ? "Deactivate Kill Switch" : "Trigger Kill Switch"}
                </Button>
                {f.kind !== "kill_switch" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs px-2.5"
                    disabled={busy || !canManage || !f.defaultOn || f.killSwitch}
                    title={!f.defaultOn || f.killSwitch ? "Turn the flag on (and clear its kill switch) before making it permanent" : undefined}
                    onClick={() => setRetireConfirm(f.key)}
                  >
                    Make permanent
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const header = (
    <TableHeader>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableHead className="px-4">Flag Key</TableHead>
        <TableHead>Default State</TableHead>
        <TableHead>Kill Switch (Emergency)</TableHead>
        <TableHead className="text-right px-4">Actions</TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title="Feature Flags & Kill Switches"
        description="Global feature flags and circuit breakers for external integrations per PLAN §6.2. Every modification is audited."
        aside={
          retired.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => setShowRetired((v) => !v)} aria-pressed={showRetired}>
              {showRetired ? "Hide permanent" : `Show permanent (${retired.length})`}
            </Button>
          ) : undefined
        }
      />

      {(!flags || flags.length === 0) ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-xs text-muted-foreground shadow-xs">
          No feature flags defined in database.
        </div>
      ) : null}

      {sections.map((section) =>
        section.flags.length === 0 ? null : (
          <section key={section.title} className="space-y-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{section.title}</h2>
              <p className="text-xs text-muted-foreground">{section.description}</p>
            </div>
            <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
              <Table>
                {header}
                <TableBody>{section.flags.map(renderRow)}</TableBody>
              </Table>
            </div>
          </section>
        ),
      )}

      {showRetired && retired.length > 0 ? (
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Permanent features</h2>
            <p className="text-xs text-muted-foreground">Always on. Kept for reference; the platform owner can restore one if needed.</p>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
            <Table>
              {header}
              <TableBody>{retired.map(renderRow)}</TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={Boolean(killSwitchConfirm)}
        onOpenChange={(open) => {
          if (!open) setKillSwitchConfirm(null);
        }}
        title="Toggle feature kill switch?"
        description={
          killSwitchConfirm
            ? `Are you sure you want to flip the kill switch for '${killSwitchConfirm.key}'? This will globally disable the feature.`
            : ""
        }
        confirmLabel="Confirm"
        destructive={Boolean(killSwitchConfirm && !killSwitchConfirm.currentKill)}
        onConfirm={async () => {
          if (killSwitchConfirm) {
            await executeKillSwitch(killSwitchConfirm.key, killSwitchConfirm.currentKill, killSwitchConfirm.defaultOn);
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(retireConfirm)}
        onOpenChange={(open) => {
          if (!open) setRetireConfirm(null);
        }}
        title="Make this feature permanent?"
        description={
          retireConfirm
            ? `'${retireConfirm}' will always be on and its Turn Off and Kill Switch controls will go away. It moves to the hidden "Permanent" list. Only the platform owner can restore it. Remove the flag check from the code afterwards.`
            : ""
        }
        confirmLabel="Make permanent"
        onConfirm={async () => {
          if (retireConfirm) await executeRetire(retireConfirm);
        }}
      />

      <ConfirmDialog
        open={Boolean(restoreConfirm)}
        onOpenChange={(open) => {
          if (!open) setRestoreConfirm(null);
        }}
        title="Restore this flag?"
        description={restoreConfirm ? `'${restoreConfirm}' returns to the Release flags list with its toggle and kill switch.` : ""}
        confirmLabel="Restore"
        onConfirm={async () => {
          if (restoreConfirm) await executeRestore(restoreConfirm);
        }}
      />
    </PageContainer>
  );
}
