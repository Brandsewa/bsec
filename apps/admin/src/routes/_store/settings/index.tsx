import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CircleCheck, ExternalLink } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton } from "@bs/ui";
import { Button } from "@bs/ui";
import { SettingsPageFrame, SettingsSection } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/")({
  pendingComponent: () => <PageSkeleton />,
  component: SettingsOverviewPage,
});

const MODE_LABEL: Record<string, string> = {
  live: "Live",
  coming_soon: "Coming soon",
  maintenance: "Maintenance",
  password: "Password protected",
};

/**
 * Settings Overview (rebuild Phases 0-1): one server-verified read model renders every card
 * (prompt §C). No client-side derivation; loading, empty and error states are explicit.
 */
export function SettingsOverviewPage() {
  const query = useQuery(orpc.admin.settingsOverview.get.queryOptions());

  if (query.isLoading) {
    return (
      <SettingsPageFrame title="Overview" description="Your store at a glance.">
        <SettingsSection>
          <FormSkeleton />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }
  if (query.isError || !query.data) {
    return (
      <SettingsPageFrame title="Overview" description="Your store at a glance.">
        <SettingsSection>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load the overview"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  const d = query.data;
  const required = d.actions.filter((a) => a.kind === "required");
  const informational = d.actions.filter((a) => a.kind === "informational");

  return (
    <SettingsPageFrame title="Overview" description="Your store at a glance: status, setup progress and what needs attention.">
      {required.length > 0 || informational.length > 0 ? (
        <SettingsSection
          title="Action required"
          description={required.length > 0 ? undefined : "Nothing blocking sales right now."}
        >
          <ul className="grid gap-2">
            {d.actions.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{a.title}</p>
                  {a.description ? <p className="mt-0.5 text-xs/relaxed text-muted-foreground">{a.description}</p> : null}
                </div>
                {a.href ? (
                  <Button variant="outline" className="shrink-0" nativeButton={false} render={<Link to={a.href} />}>
                    Fix
                    <ArrowRight className="size-3.5" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </SettingsSection>
      ) : (
        <SettingsSection title="Action required">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-emerald-600" />
            Everything needed to sell is set up.
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="Store status">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Availability</p>
            <p className="text-sm font-medium text-foreground">{MODE_LABEL[d.storeStatus.mode] ?? d.storeStatus.mode}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Storefront</p>
            {d.storeStatus.storefrontUrl ? (
              <a
                href={d.storeStatus.storefrontUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline underline-offset-2 hover:no-underline"
              >
                {d.storeStatus.storefrontUrl.replace(/^https?:\/\//, "")}
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">Not reachable yet</p>
            )}
          </div>
          {d.domains.storefrontHostname ? (
            <div>
              <p className="text-xs text-muted-foreground">Domain</p>
              <p className="text-sm font-medium text-foreground">{d.domains.storefrontHostname}</p>
            </div>
          ) : null}
          {d.plan ? (
            <div>
              <p className="text-xs text-muted-foreground">Plan</p>
              <p className="text-sm font-medium text-foreground capitalize">
                {d.plan.name} ({d.plan.status}, {d.plan.interval})
              </p>
            </div>
          ) : null}
          <div>
            <p className="text-xs text-muted-foreground">Payment</p>
            <p className="text-sm font-medium text-foreground">
              {d.payments.codEnabled ? "Cash on delivery" : "No method available"}
              {d.payments.onlinePaymentAvailable ? ", online payment" : ""}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Setup progress</p>
            <p className="text-sm font-medium text-foreground">
              {d.onboarding.completedCount}/{d.onboarding.totalCount} steps complete
            </p>
          </div>
        </div>
      </SettingsSection>

      {d.quickLinks.length > 0 ? (
        <SettingsSection title="Quick links">
          <div className="flex flex-wrap gap-2">
            {d.quickLinks.map((q) => (
              <Button key={q.href + q.label} variant="outline" nativeButton={false} render={<Link to={q.href} />}>
                {q.label}
              </Button>
            ))}
          </div>
        </SettingsSection>
      ) : null}
    </SettingsPageFrame>
  );
}
