import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, LifeBuoy } from "lucide-react";
import {
  Button,
  EmptyState,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  TableSkeleton,
  toast,
} from "@bs/ui";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/support")({
  pendingComponent: () => <PageSkeleton />,
  component: SupportAccessPage,
});

const STATUS_TEXT: Record<string, string> = {
  pending_owner_approval: "Waiting for your decision",
  active: "Active",
  denied: "Denied",
  ended: "Ended",
  expired: "Expired",
};

export function SupportAccessPage() {
  const queryClient = useQueryClient();
  const sessions = useQuery(orpc.admin.support.list.queryOptions());
  const standing = useQuery(orpc.admin.support.getStandingConsent.queryOptions());
  const approve = useMutation(orpc.admin.support.approve.mutationOptions());
  const deny = useMutation(orpc.admin.support.deny.mutationOptions());
  const setStanding = useMutation(orpc.admin.support.setStandingConsent.mutationOptions());

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.support.key() });
  const list = sessions.data ?? [];
  const pending = list.filter((s) => s.status === "pending_owner_approval");

  return (
    <PageContainer size="small">
      <PageBreadcrumbs items={[{ label: "Settings" }, { label: "Support access" }]} />
      <PageHeader
        title="Support access"
        description="The platform team can look into your store only with your approval. Only the store owner can decide here, and every action they take is recorded."
      />

      {sessions.isLoading || standing.isLoading ? (
        <TableSkeleton rows={3} columns={3} />
      ) : sessions.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load support access"
          description={errorMessage(sessions.error)}
          action={<Button onClick={() => void sessions.refetch()}>Try again</Button>}
        />
      ) : (
        <>
          <PageSection title="Requests waiting for you" description="Approving starts a 60-minute, read-only session. You can deny any request.">
            {pending.length === 0 ? (
              <p className="text-sm text-foreground-lighter">No requests are waiting.</p>
            ) : (
              <ul className="grid gap-3">
                {pending.map((s) => (
                  <li key={s.id} className="grid gap-2 rounded-md border border-border p-3" data-testid="support-request">
                    <div className="text-sm">
                      <strong>{s.staffName}</strong> ({s.staffEmail}) asks to look into your store
                    </div>
                    <div className="text-sm text-foreground-lighter">
                      Reason: {s.reason} · Ticket: {s.ticketRef} · Requested {new Date(s.requestedAt).toLocaleString("en-IN")}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={approve.isPending}
                        onClick={() =>
                          approve.mutate(
                            { id: s.id },
                            { onSuccess: () => { toast.success("Approved. The session lasts 60 minutes."); refresh(); }, onError: (e) => toast.error(errorMessage(e)) },
                          )
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        disabled={deny.isPending}
                        onClick={() =>
                          deny.mutate(
                            { id: s.id },
                            { onSuccess: () => { toast.success("Request denied."); refresh(); }, onError: (e) => toast.error(errorMessage(e)) },
                          )
                        }
                      >
                        Deny
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PageSection>

          <PageSection title="Standing consent" description="If you switch this on, the platform team can open read-only sessions without asking each time. Every session is still recorded and shown below.">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={standing.data?.enabled ?? false}
                disabled={setStanding.isPending}
                onChange={(e) =>
                  setStanding.mutate(
                    { enabled: e.target.checked },
                    { onSuccess: () => { toast.success(e.target.checked ? "Standing consent is on." : "Standing consent is off."); refresh(); }, onError: (err) => toast.error(errorMessage(err)) },
                  )
                }
              />
              Allow platform support to open read-only sessions without asking first
            </label>
          </PageSection>

          <PageSection title="History" description="Every support session on your store, newest first.">
            {list.length === 0 ? (
              <EmptyState icon={LifeBuoy} title="No support sessions yet" description="If the platform team ever needs to look into your store, it will appear here." />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-foreground-lighter">
                  <tr>
                    <th className="py-1">Who</th>
                    <th>Reason / ticket</th>
                    <th>Access</th>
                    <th>Status</th>
                    <th>Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} className="border-t border-border align-top">
                      <td className="py-1">{s.staffName}</td>
                      <td>{s.reason} <span className="text-foreground-lighter">({s.ticketRef})</span></td>
                      <td>{s.scope === "write" ? "read & write" : "read only"} · {s.consent.replace(/_/g, " ")}</td>
                      <td>{STATUS_TEXT[s.status] ?? s.status}</td>
                      <td>{s.actionsCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </PageSection>
        </>
      )}
    </PageContainer>
  );
}
