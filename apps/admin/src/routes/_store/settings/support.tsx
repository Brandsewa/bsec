import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, LifeBuoy } from "lucide-react";
import { EmptyState, PageSkeleton, TableSkeleton, toast } from "@bs/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { SettingsPageFrame, SettingsSection } from "../../../components/settings/settings-page.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <SettingsPageFrame
      title="Support access"
      description="The platform team can look into your store only with your approval. Only the store owner can decide here, and every action they take is recorded."
    >
      {sessions.isLoading || standing.isLoading ? (
        <SettingsSection>
          <TableSkeleton rows={3} columns={3} />
        </SettingsSection>
      ) : sessions.isError ? (
        <SettingsSection>
        <EmptyState
          icon={AlertTriangle}
          title="Could not load support access"
          description={errorMessage(sessions.error)}
          action={<Button onClick={() => void sessions.refetch()}>Try again</Button>}
        />
        </SettingsSection>
      ) : (
        <>
          <SettingsSection title="Requests waiting for you" description="Approving starts a 60-minute, read-only session. You can deny any request.">
            {pending.length === 0 ? (
              <p className="text-xs text-foreground-lighter">No requests are waiting.</p>
            ) : (
              <ul className="grid gap-3">
                {pending.map((s) => (
                  <li key={s.id} className="grid gap-2 rounded-md border border-border p-3" data-testid="support-request">
                    <div className="text-xs">
                      <strong>{s.staffName}</strong> ({s.staffEmail}) asks to look into your store
                    </div>
                    <div className="text-xs text-foreground-lighter">
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
                        variant="outline"
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
          </SettingsSection>

          <SettingsSection title="Standing consent" description="If you switch this on, the platform team can open read-only sessions without asking each time. Every session is still recorded and shown below.">
            <Field orientation="horizontal">
              <Checkbox
                id="standing-consent"
                checked={standing.data?.enabled ?? false}
                disabled={setStanding.isPending}
                onCheckedChange={(checked) =>
                  setStanding.mutate(
                    { enabled: checked },
                    { onSuccess: () => { toast.success(checked ? "Standing consent is on." : "Standing consent is off."); refresh(); }, onError: (err) => toast.error(errorMessage(err)) },
                  )
                }
              />
              <FieldLabel htmlFor="standing-consent" className="font-normal">
                Allow platform support to open read-only sessions without asking first
              </FieldLabel>
            </Field>
          </SettingsSection>

          <SettingsSection title="History" description="Every support session on your store, newest first.">
            {list.length === 0 ? (
              <EmptyState icon={LifeBuoy} title="No support sessions yet" description="If the platform team ever needs to look into your store, it will appear here." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Who</TableHead>
                    <TableHead>Reason / ticket</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Requests</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((s) => (
                    <TableRow key={s.id} className="align-top">
                      <TableCell>{s.staffName}</TableCell>
                      <TableCell className="whitespace-normal">{s.reason} <span className="text-muted-foreground">({s.ticketRef})</span></TableCell>
                      <TableCell className="whitespace-normal">{s.scope === "write" ? "read & write" : "read only"} · {s.consent.replace(/_/g, " ")}</TableCell>
                      <TableCell>{STATUS_TEXT[s.status] ?? s.status}</TableCell>
                      <TableCell>{s.actionsCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SettingsSection>
        </>
      )}
    </SettingsPageFrame>
  );
}
