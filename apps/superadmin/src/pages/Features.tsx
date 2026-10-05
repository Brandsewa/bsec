import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";

export function Features() {
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [killSwitchConfirm, setKillSwitchConfirm] = useState<{
    key: string;
    currentKill: boolean;
    defaultOn: boolean;
  } | null>(null);

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

  if (isLoading) return <PageSkeleton />;

  return (
    <PageContainer>
      <PageHeader
        title="Feature Flags & Kill Switches"
        description="Global feature flags and circuit breakers for external integrations per PLAN §6.2. Every modification is audited."
      />

      <div className="rounded-xl border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Flag Key</TableHead>
              <TableHead>Default State</TableHead>
              <TableHead>Kill Switch (Emergency)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(!flags || flags.length === 0) ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-6 text-xs text-muted-foreground">
                  No feature flags defined in database.
                </TableCell>
              </TableRow>
            ) : (
              flags.map((f) => (
                <TableRow key={f.key}>
                  <TableCell className="font-mono text-xs font-semibold">{f.key}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      f.defaultOn
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {f.defaultOn ? "Enabled by Default" : "Disabled by Default"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {f.killSwitch ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-destructive/15 text-destructive uppercase tracking-wide">
                        ACTIVATED
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Off (Normal operation)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs px-2"
                        disabled={updatingKey === f.key}
                        onClick={() => handleToggle(f.key, f.defaultOn)}
                      >
                        {f.defaultOn ? "Turn Off" : "Turn On"}
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        className={`h-7 text-xs px-2 ${f.killSwitch ? "text-primary" : "text-destructive hover:bg-destructive/10"}`}
                        disabled={updatingKey === f.key}
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
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
            await executeKillSwitch(
              killSwitchConfirm.key,
              killSwitchConfirm.currentKill,
              killSwitchConfirm.defaultOn,
            );
          }
        }}
      />
    </PageContainer>
  );
}
