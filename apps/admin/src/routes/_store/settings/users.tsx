import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AlertTriangle, ShieldCheck, Users } from "lucide-react";
import { EmptyState, PageSkeleton, TableSkeleton, toast } from "@bs/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "../../../components/confirm-dialog.tsx";
import { Field } from "../../../components/field.tsx";
import { SettingsPageFrame, SettingsSection } from "../../../components/settings/settings-page.tsx";
import { SimpleSelect } from "../../../components/simple-select.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/users")({
  pendingComponent: () => <PageSkeleton />,
  component: UsersSettingsPage,
});

const TITLE = "Users & accounts";
const DESCRIPTION = "People who can sign in to this store's admin, and what they can do.";

export function UsersSettingsPage() {
  const queryClient = useQueryClient();
  let store: { tenantId: string } | undefined;
  try {
    const ctx = Route.useRouteContext() as Record<string, unknown> | undefined;
    if (ctx && typeof ctx === "object" && "store" in ctx) {
      store = ctx.store as { tenantId: string };
    }
  } catch {
    // In isolated unit tests where parent route tree is not mounted
    store = undefined;
  }
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
  const [toRemove, setToRemove] = useState<{ id: string; email: string } | null>(null);

  const roleList = roles.data ?? [];
  const effectiveRoleId = roleId || roleList.find((r) => r.name === "store_admin")?.id || roleList[0]?.id || "";
  const roleOptions = roleList.map((r) => ({ value: r.id, label: r.name.replace("store_", "") }));

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

  if (loading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <TableSkeleton rows={4} columns={3} />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }
  if (failed) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load users"
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
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  const memberList = members.data ?? [];
  const pending = invitations.data ?? [];
  const ownerMembers = memberList.filter((m) => m.roleName === "store_owner");

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {/* Read-only Store Owner identity summary */}
      <SettingsSection
        title="Store Owner"
        description="The primary owner holds administrative and financial authority over this store. Store ownership transfer requires re-authenticated verification and is managed outside staff roles."
      >
        <div className="rounded-md border border-border bg-card p-4">
          {ownerMembers.length === 0 ? (
            <p className="text-xs text-muted-foreground">Owner identity not determined.</p>
          ) : (
            <div className="grid gap-3">
              {ownerMembers.map((owner) => (
                <div key={owner.id} className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div className="grid">
                    <span className="text-xs font-medium text-foreground">{owner.name || owner.email}</span>
                    <span className="text-xs text-muted-foreground">{owner.email}</span>
                  </div>
                  <span className="ml-auto inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-foreground">
                    Store Owner
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title="Members" description="Staff with active access to this store.">
        {memberList.length === 0 ? (
          <EmptyState icon={Users} title="No members yet" description="Invite someone below." />
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {memberList.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="grid">
                  <span className="text-xs font-medium text-foreground">{m.name || m.email}</span>
                  <span className="text-muted-foreground">{m.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <SimpleSelect
                    ariaLabel={`Role for ${m.email}`}
                    className="w-32"
                    value={m.roleId ?? ""}
                    options={roleOptions}
                    onChange={(v) =>
                      setRole.mutate(
                        { id: m.id, roleId: v },
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
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => setToRemove({ id: m.id, email: m.email ?? m.name ?? "this member" })}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection title="Invite someone" description="They get a link to set their own password. Passwords are never emailed or shown.">
        <form onSubmit={onInvite} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
          <Field id="inviteEmail" label="Email">
            <Input id="inviteEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="inviteRole" label="Role">
            <SimpleSelect id="inviteRole" value={effectiveRoleId} options={roleOptions} onChange={setRoleId} />
          </Field>
          <Button type="submit" disabled={invite.isPending || !email || !effectiveRoleId}>
            {invite.isPending ? "Creating…" : "Create invite"}
          </Button>
        </form>
        {link ? (
          <div className="grid gap-2 rounded-md border border-border bg-muted p-3">
            <p className="text-xs text-foreground">Email is not set up yet, so copy this link and send it to them yourself. It works once and expires in 7 days.</p>
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
              <Button
                type="button"
                variant="outline"
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
      </SettingsSection>

      {pending.length > 0 ? (
        <SettingsSection title="Pending invitations">
          <ul className="divide-y divide-border rounded-md border border-border">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                <span className="text-foreground">{inv.email}</span>
                <span className="flex items-center gap-3">
                  <span className="text-muted-foreground">expires {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString("en-IN") : "soon"}</span>
                  <Button
                    variant="outline"
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
        </SettingsSection>
      ) : null}

      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(open) => !open && setToRemove(null)}
        title={`Remove ${toRemove?.email ?? "member"}?`}
        description="They will lose access to this store's admin immediately."
        confirmLabel="Remove"
        cancelLabel="Keep member"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          const target = toRemove;
          setToRemove(null);
          if (!target) return;
          remove.mutate(
            { id: target.id },
            {
              onSuccess: () => {
                toast.success("Member removed");
                refresh();
              },
              onError: (err) => toast.error(errorMessage(err)),
            },
          );
        }}
      />
    </SettingsPageFrame>
  );
}
