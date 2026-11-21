import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Mail, ShieldAlert } from "lucide-react";
import { Badge, Button, EmptyState, FormSkeleton } from "@bs/ui";
import { AccountCard } from "./account-card.tsx";
import { client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { ACCESS_LABEL, isFullAccessRole, roleDisplayName, roleSummary, summarizeAccess, type AccessLevel } from "../../lib/access-summary.ts";

type Access = Awaited<ReturnType<typeof client.admin.account.get>>["access"][number];

const LEVEL_VARIANT: Record<AccessLevel, "default" | "secondary" | "outline"> = { manage: "default", view: "secondary", none: "outline" };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : null);

/**
 * Only the signed-in person's own access, one block per store. Everyone's access is managed under Settings, Users.
 * Presentation only: what a person can actually do is decided by the domain services, never by this page.
 */
export function PermissionsTab() {
  const profile = useQuery({ queryKey: ["admin", "account"], queryFn: () => client.admin.account.get() });
  if (profile.isLoading) {
    return (
      <AccountCard>
        <FormSkeleton />
      </AccountCard>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <AccountCard>
        <EmptyState icon={AlertTriangle} title="Could not load your access" description={errorMessage(profile.error)} action={<Button onClick={() => void profile.refetch()}>Try again</Button>} />
      </AccountCard>
    );
  }
  if (profile.data.access.length === 0) {
    return (
      <AccountCard title="Your access">
        <p className="text-sm text-muted-foreground">You are not a member of any store.</p>
      </AccountCard>
    );
  }
  return (
    <div className="grid gap-4">
      {profile.data.access.map((a) => (
        <StoreAccess key={a.tenantId} access={a} />
      ))}
    </div>
  );
}

function StoreAccess({ access }: { access: Access }) {
  const full = isFullAccessRole(access.role);
  const rows = summarizeAccess(access.permissions);
  const canManageTeam = full || access.permissions.includes("staff.manage");
  const mailto = access.owner
    ? `mailto:${access.owner.email}?subject=${encodeURIComponent(`Access change request for ${access.storeName}`)}&body=${encodeURIComponent(
        `Hi ${access.owner.name},\n\nI would like to ask for a change to my access in ${access.storeName}. My current role is ${roleDisplayName(access.role)}.\n\nWhat I need, and why:\n`,
      )}`
    : null;
  return (
    <>
      <AccountCard
        title={access.storeName}
        description="Your role in this store"
        actions={
          mailto ? (
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={mailto} />}>
              <Mail className="mr-2 size-3.5" aria-hidden />
              Ask for access changes
            </Button>
          ) : null
        }
      >
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Role</dt>
            <dd className="mt-0.5 font-medium text-foreground">{roleDisplayName(access.role)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{full ? "Store" : "Granted by"}</dt>
            <dd className="mt-0.5 font-medium text-foreground">{full ? "You own it" : (access.invitedBy ?? "The store owner")}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Joined</dt>
            <dd className="mt-0.5 font-medium text-foreground">{day(access.joinedAt) ?? "Not recorded"}</dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">{roleSummary(access.role, rows)}</p>
        {!full && !mailto ? <p className="text-xs text-muted-foreground">To change your access, ask the store owner.</p> : null}
        {canManageTeam ? (
          <p className="text-xs text-muted-foreground">
            Everyone's access is managed in{" "}
            <Link to="/settings/users" className="font-medium text-foreground underline underline-offset-2">
              Settings, Users
            </Link>
            .
          </p>
        ) : null}
      </AccountCard>

      {full ? (
        <AccountCard title="What you can do">
          <div className="flex items-start gap-3" data-testid="full-store-access">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-foreground" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-foreground">Full store access</p>
              <p className="text-sm text-muted-foreground">As the owner you can use every part of the store, including payments and who has access.</p>
            </div>
          </div>
        </AccountCard>
      ) : (
        <AccountCard title="What you can do" description="Grouped by area. This is a summary; the server checks every action.">
          <ul className="divide-y divide-border-soft" data-testid="capability-rows">
            {rows.map((r) => (
              <li key={r.key} className="grid gap-1.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{r.label}</p>
                  <p className="text-xs text-muted-foreground">{r.level === "none" ? r.description : r.detail}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                  <Badge variant={LEVEL_VARIANT[r.level]}>{ACCESS_LABEL[r.level]}</Badge>
                  {r.sensitive ? (
                    <Badge variant="outline">
                      <ShieldAlert className="mr-1 size-3" aria-hidden />
                      Sensitive access
                    </Badge>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </AccountCard>
      )}

      <details className="min-w-0 rounded-lg border border-border bg-background p-4 shadow-xs sm:p-5" data-testid="advanced-permissions">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">Advanced permission details</summary>
        <p className="mt-2 text-xs text-muted-foreground">Raw permission identifiers for {access.storeName}. Only useful for support and debugging.</p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {[...access.permissions].sort().map((p) => (
            <li key={p}>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{p}</code>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
