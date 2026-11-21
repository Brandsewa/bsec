import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { Badge, Button, EmptyState, PageSkeleton, TableSkeleton } from "@bs/ui";
import { SettingsCard, SettingsPageFrame } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/seo")({
  pendingComponent: () => <PageSkeleton />,
  component: SeoHealthPage,
});

const STATUS = {
  ok: { icon: CheckCircle2, label: "Good", className: "text-emerald-600" },
  warn: { icon: CircleAlert, label: "Could be better", className: "text-amber-600" },
  fail: { icon: XCircle, label: "Needs attention", className: "text-destructive" },
} as const;

export function SeoHealthPage() {
  const health = useQuery(orpc.admin.seo.health.queryOptions());
  const checks = health.data?.checks ?? [];
  const attention = checks.filter((c) => c.status !== "ok").length;

  return (
    <SettingsPageFrame
      title="SEO health"
      description="What search engines and AI assistants can see on your store, and what to add so shoppers find you. Nothing here changes your store."
    >
      {health.isLoading ? (
        <SettingsCard>
          <TableSkeleton rows={6} columns={2} />
        </SettingsCard>
      ) : health.isError ? (
        <SettingsCard>
          <EmptyState icon={AlertTriangle} title="Could not load the report" description={errorMessage(health.error)} action={<Button onClick={() => void health.refetch()}>Try again</Button>} />
        </SettingsCard>
      ) : (
        <>
          <SettingsCard title="Summary" description={attention === 0 ? "Everything we check looks good." : `${attention} ${attention === 1 ? "thing" : "things"} to look at.`}>
            <p className="text-sm text-muted-foreground">
              <span className="text-2xl font-semibold text-foreground">{health.data?.indexablePageCount ?? 0}</span> pages are listed in your sitemap for search engines.
            </p>
          </SettingsCard>
          <SettingsCard title="Checks">
            <ul className="divide-y divide-border">
              {checks.map((c) => {
                const s = STATUS[c.status];
                return (
                  <li key={c.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <s.icon className={`mt-0.5 size-5 shrink-0 ${s.className}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{c.label}</p>
                        {c.count ? <Badge variant="secondary">{c.count}</Badge> : null}
                        <span className="sr-only">{s.label}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{c.detail}</p>
                    </div>
                    {c.status !== "ok" && c.fixHref ? (
                      <Button variant="outline" size="sm" nativeButton={false} render={<Link to={c.fixHref} />}>
                        Fix
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </SettingsCard>
        </>
      )}
    </SettingsPageFrame>
  );
}
