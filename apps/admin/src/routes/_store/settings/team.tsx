import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, Users } from "lucide-react";
import {
  Button,
  EmptyState,
  Input,
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
import { Field } from "../../../components/field.tsx";

export const Route = createFileRoute("/_store/settings/team")({
  pendingComponent: () => <PageSkeleton />,
  component: TeamSettingsPage,
});

export function TeamSettingsPage() {
  const queryClient = useQueryClient();
  const { store } = useRouteContext({ from: "/_store" });
  const members = useQuery(orpc.admin.memberships.list.queryOptions());
  const roles = useQuery(orpc.admin.memberships.roles.queryOptions());
  const invitations = useQuery(orpc.admin.memberships.invitations.queryOptions());
  const invite = useMutation(orpc.admin.memberships.invite.mutationOptions());
  const setRole = useMutation(orpc.admin.memberships.setRole.mutationOptions());
  const remove = useMutation(orpc.admin.memberships.remove.mutationOptions());
  const revoke = useMutation(orpc.admin.memberships.revokeInvitation.mutationOptions());

  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [link, setLink] = useState<string | null>(null);

  const roleList = roles.data ?? [];
  const effectiveRoleId = roleId || roleList.find((r) => r.name === "store_admin")?.id || roleList[0]?.id || "";

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.memberships.key() });
  }

  function onInvite(e: FormEvent) {
    e.preventDefault();
    invite.mutate(
      { email: email.trim(), roleId: effectiveRoleId },
      {
        onSuccess: (res) => {
          setEmail("");
          if (res.token && store) {
            setLink(`${window.location.origin}/accept-invite?store=${store.tenantId}&token=${res.token}`);
          }
          toast.success("Invitation created");
          refresh();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  const loading = members.isLoading || roles.isLoading;
  const failed = members.isError || roles.isError;

  return (
    <PageContainer size="small">
      <PageBreadcrumbs items={[{ label: "Settings" }, { label: "Team" }]} />
      <PageHeader title="Team" description="People who can sign in to this store's admin, and what they can do." />

      {loading ? (
        <TableSkeleton rows={4} columns={3} />
      ) : failed ? (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load your team"
          description={errorMessage(members.error ?? roles.error)}
          action={
            <Button
              onClick={() => {
                void members.refetch();
                void roles.refetch();
              }}
            >
              Try again
            </Button>
          }
        />
      ) : (
        <div className="grid gap-6">
          <PageSection title="Members">
            {(members.data ?? []).length === 0 ? (
              <EmptyState icon={Users} title="No members yet" description="Invite someone below." />
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {(members.data ?? []).map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="grid">
                      <span className="text-sm font-medium">{m.name || m.email}</span>
                      <span className="text-xs text-foreground-lighter">{m.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`Role for ${m.email}`}
                        className="h-8 rounded-md border border-border-control bg-control px-2 text-sm"
                        value={m.roleId}
                        disabled={setRole.isPending}
                        onChange={(e) =>
                          setRole.mutate(
                            { id: m.id, roleId: e.target.value },
                            {
                              onSuccess: () => {
                                toast.success("Role updated");
                                refresh();
                              },
                              onError: (err) => {
                                toast.error(errorMessage(err));
                                refresh();
                              },
                            },
                          )
                        }
                      >
                        {roleList.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name.replace("store_", "")}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="default"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (!window.confirm(`Remove ${m.email} from this store?`)) return;
                          remove.mutate(
                            { id: m.id },
                            {
                              onSuccess: () => {
                                toast.success("Member removed");
                                refresh();
                              },
                              onError: (err) => toast.error(errorMessage(err)),
                            },
                          );
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PageSection>

          <PageSection title="Invite someone" description="They get a link to set their own password. Passwords are never emailed or shown.">
            <form onSubmit={onInvite} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
              <Field id="inviteEmail" label="Email">
                <Input id="inviteEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field id="inviteRole" label="Role">
                <select
                  id="inviteRole"
                  className="h-9 w-full rounded-md border border-border-control bg-control px-3 text-sm"
                  value={effectiveRoleId}
                  onChange={(e) => setRoleId(e.target.value)}
                >
                  {roleList.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name.replace("store_", "")}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit" disabled={invite.isPending || !email || !effectiveRoleId}>
                {invite.isPending ? "Creating…" : "Create invite"}
              </Button>
            </form>
            {link ? (
              <div className="grid gap-2 rounded-md border border-border bg-surface-100 p-3">
                <p className="text-sm">
                  Email is not set up yet, so copy this link and send it to them yourself. It works once and expires in 7 days.
                </p>
                <div className="flex gap-2">
                  <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => {
                      void navigator.clipboard.writeText(link).then(
                        () => toast.success("Link copied"),
                        () => toast.error("Could not copy. Select the link and copy it manually."),
                      );
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            ) : null}
          </PageSection>

          {(invitations.data ?? []).length > 0 ? (
            <PageSection title="Pending invitations">
              <ul className="divide-y divide-border rounded-md border border-border">
                {(invitations.data ?? []).map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <span>{inv.email}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-foreground-lighter">
                        expires {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString("en-IN") : "soon"}
                      </span>
                      <Button
                        variant="default"
                        size="sm"
                        disabled={revoke.isPending}
                        onClick={() =>
                          revoke.mutate(
                            { id: inv.id },
                            {
                              onSuccess: () => {
                                toast.success("Invitation revoked");
                                refresh();
                              },
                              onError: (err) => toast.error(errorMessage(err)),
                            },
                          )
                        }
                      >
                        Revoke
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </PageSection>
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}
