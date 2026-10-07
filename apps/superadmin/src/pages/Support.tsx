import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Headphones } from "lucide-react";
import {
  Button,
  ConfirmDialog,
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
import { messageOf } from "../lib/errors.ts";
import { useHasRole, useStaff } from "../lib/user-context.tsx";

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  pending_owner_approval: { text: "Waiting for the store owner to approve", className: "text-amber-600 dark:text-amber-400" },
  active: { text: "Active", className: "text-emerald-600 dark:text-emerald-400 font-medium" },
  denied: { text: "Denied by the store owner", className: "text-destructive" },
  ended: { text: "Ended", className: "text-muted-foreground" },
  expired: { text: "Expired", className: "text-muted-foreground" },
};

export function Support() {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [elevateSessionId, setElevateSessionId] = useState<string | null>(null);
  const staff = useStaff();
  const isAdmin = useHasRole("platform_admin");

  const { data: sessions, isLoading, refetch } = useQuery({
    queryKey: ["platform", "support-sessions"],
    queryFn: () => client.support.list(),
  });

  const run = async (id: string, action: () => Promise<unknown>, ok: string, failed: string) => {
    setLoadingId(id);
    try {
      await action();
      toast.success(ok);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, failed));
    } finally {
      setLoadingId(null);
    }
  };

  if (isLoading) return <PageSkeleton />;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Support & Impersonation Sessions"
        description="Audited, time-boxed access to store admins: 60 minutes, extendable once, read-only until an admin confirms write access. Start one from a store's page."
      />

      {!sessions || sessions.length === 0 ? (
        <EmptyState icon={Headphones} title="No support sessions on record" description="Sessions started by platform staff for troubleshooting are tracked here." />
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Store</TableHead>
                <TableHead>Reason / Ticket</TableHead>
                <TableHead>Consent</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Actions run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right px-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => {
                const status = STATUS_LABEL[s.status] ?? { text: s.status, className: "" };
                const mine = s.platformUserId === staff.id;
                const live = s.status === "active" || s.status === "pending_owner_approval";
                const canManage = live && (mine || isAdmin);
                return (
                  <TableRow key={s.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-mono text-xs font-semibold px-4 text-foreground">{s.tenantId.substring(0, 8)}...</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium text-foreground">{s.reason}</div>
                      <div className="text-muted-foreground font-mono text-[11px]">{s.ticketRef}</div>
                    </TableCell>
                    <TableCell className="text-xs capitalize">{s.consent.replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          s.scope === "write" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold" : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                        }`}
                      >
                        {s.scope === "write" ? "write" : "read only"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs font-mono font-medium">{s.actionsCount} requests</TableCell>
                    <TableCell className="text-xs">
                      <span className={status.className}>{status.text}</span>
                      {s.status === "active" && <div className="text-muted-foreground text-[11px]">ends {new Date(s.expiresAt).toLocaleTimeString()}</div>}
                    </TableCell>
                    <TableCell className="text-right px-4">
                      {canManage && (
                        <div className="flex items-center justify-end gap-1.5">
                          {s.status === "active" && !s.isExtended && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs px-2" disabled={loadingId === s.id} onClick={() => run(s.id, () => client.support.extend({ id: s.id }), "Session extended by 60 minutes", "Failed to extend the session")}>
                              Extend
                            </Button>
                          )}
                          {isAdmin && s.status === "active" && s.scope !== "write" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs px-2"
                              disabled={loadingId === s.id}
                              onClick={() => setElevateSessionId(s.id)}
                            >
                              Allow write
                            </Button>
                          )}
                          <Button variant="destructive" size="sm" className="h-7 text-xs px-2" disabled={loadingId === s.id} onClick={() => run(s.id, () => client.support.end({ id: s.id }), "Session ended", "Failed to end the session")}>
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

      <ConfirmDialog
        open={Boolean(elevateSessionId)}
        onOpenChange={(open) => {
          if (!open) setElevateSessionId(null);
        }}
        title="Grant write access for support session?"
        description="Grant WRITE access for this session? Every change will be made in the store's name and audited."
        confirmLabel="Grant write access"
        onConfirm={async () => {
          if (elevateSessionId) {
            await run(
              elevateSessionId,
              () => client.support.elevateWrite({ id: elevateSessionId }),
              "Write access granted",
              "Failed to grant write access",
            );
            setElevateSessionId(null);
          }
        }}
      />
    </PageContainer>
  );
}
