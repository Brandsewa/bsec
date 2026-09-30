import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Headphones, Clock, ShieldCheck, XCircle, FastForward } from "lucide-react";
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

export function Support() {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data: sessions, isLoading, refetch } = useQuery({
    queryKey: ["platform", "support-sessions"],
    queryFn: () => client.support.list(),
  });

  const handleEnd = async (id: string) => {
    setLoadingId(id);
    try {
      await client.support.end({ id });
      toast.success("Support session terminated immediately");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to end support session");
    } finally {
      setLoadingId(null);
    }
  };

  const handleExtend = async (id: string) => {
    setLoadingId(id);
    try {
      const res = await client.support.extend({ id });
      toast.success(`Session extended until ${new Date(res.expiresAt).toLocaleTimeString()}`);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to extend session (already extended once)");
    } finally {
      setLoadingId(null);
    }
  };

  if (isLoading) return <PageSkeleton />;

  return (
    <PageContainer>
      <PageHeader
        title="Support & Impersonation Sessions"
        description="Audited time-boxed access to merchant store admins. Maximum 60 minutes, extendable once."
      />

      {!sessions || sessions.length === 0 ? (
        <EmptyState
          icon={Headphones}
          title="No support sessions on record"
          description="Support sessions initiated by platform staff for troubleshooting will be tracked here."
        />
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store Tenant</TableHead>
                <TableHead>Reason / Ticket</TableHead>
                <TableHead>Consent Mode</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Actions Run</TableHead>
                <TableHead>Status & Timing</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => {
                const isEnded = Boolean(s.endedAt) || new Date(s.expiresAt).getTime() < Date.now();
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs font-semibold">{s.tenantId.substring(0, 8)}...</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium text-foreground">{s.reason}</div>
                      <div className="text-muted-foreground font-mono text-[11px]">{s.ticketRef}</div>
                    </TableCell>
                    <TableCell className="text-xs capitalize">
                      {s.consent.replace("_", " ")}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        s.scope === "write"
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold"
                          : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                      }`}>
                        {s.scope}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs font-mono font-medium">{s.actionsCount} actions</TableCell>
                    <TableCell className="text-xs">
                      {isEnded ? (
                        <span className="text-muted-foreground">Ended {s.endedAt ? new Date(s.endedAt).toLocaleTimeString() : ""}</span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          Active · ends {new Date(s.expiresAt).toLocaleTimeString()}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!isEnded && (
                        <div className="flex items-center justify-end gap-1">
                          {!s.isExtended && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs px-2"
                              disabled={loadingId === s.id}
                              onClick={() => handleExtend(s.id)}
                            >
                              Extend
                            </Button>
                          )}
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 text-xs px-2"
                            disabled={loadingId === s.id}
                            onClick={() => handleEnd(s.id)}
                          >
                            End
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </PageContainer>
  );
}
