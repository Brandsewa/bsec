import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flag, ShieldAlert, CheckCircle2 } from "lucide-react";
import {
  Button,
  EmptyState,
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

export function Features() {
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  const { data: flags, isLoading, refetch } = useQuery({
    queryKey: ["platform", "features"],
    queryFn: () => client.features.list(),
  });

  const handleToggle = async (key: string, currentOn: boolean, killSwitch: boolean) => {
    setUpdatingKey(key);
    try {
      await client.features.update({
        featureKey: key,
        defaultOn: !currentOn,
      });
      toast.success(`Flag '${key}' updated to ${!currentOn ? "enabled" : "disabled"}`);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update feature flag");
    } finally {
      setUpdatingKey(null);
    }
  };

  const handleKillSwitch = async (key: string, currentKill: boolean, defaultOn: boolean) => {
    if (!confirm(`Are you sure you want to flip the kill switch for '${key}'? This will globally disable the feature.`)) return;
    setUpdatingKey(key);
    try {
      await client.features.update({
        featureKey: key,
        defaultOn,
        killSwitch: !currentKill,
      });
      toast.success(`Kill switch for '${key}' updated`);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to toggle kill switch");
    } finally {
      setUpdatingKey(null);
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
                        onClick={() => handleToggle(f.key, f.defaultOn, f.killSwitch)}
                      >
                        {f.defaultOn ? "Turn Off" : "Turn On"}
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        className={`h-7 text-xs px-2 ${f.killSwitch ? "text-primary" : "text-destructive hover:bg-destructive/10"}`}
                        disabled={updatingKey === f.key}
                        onClick={() => handleKillSwitch(f.key, f.killSwitch, f.defaultOn)}
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
    </PageContainer>
  );
}
