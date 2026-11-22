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

const LINK_KIND_LABEL = {
  broken: "Page not found",
  platform_host: "Preview address",
  shopify_checkout: "Old checkout link",
  www_host: "www not connected",
} as const;

/** Links in menus and published pages that lead nowhere, with what to do about each. Read-only. */
function BrokenLinksCard() {
  const links = useQuery(orpc.admin.seo.links.queryOptions());
  const problems = links.data?.problems ?? [];
  return (
    <SettingsCard
      title="Links that lead nowhere"
      description={
        links.data
          ? problems.length === 0
            ? `We read ${links.data.scanned} links in your menus and pages and found no problems.`
            : `${problems.length}${links.data.truncated ? "+" : ""} of ${links.data.scanned} links need fixing. Edit the link where it is used, or add a redirect.`
          : "Checks the links in your menus and published pages against what your store really has."
      }
    >
      {links.isLoading ? (
        <TableSkeleton rows={3} columns={2} />
      ) : links.isError ? (
        <EmptyState icon={AlertTriangle} title="Could not check your links" description={errorMessage(links.error)} action={<Button onClick={() => void links.refetch()}>Try again</Button>} />
      ) : problems.length === 0 ? null : (
        <ul className="divide-y divide-border/60">
          {problems.map((p) => (
            <li key={`${p.where.type}|${p.where.label}|${p.link}`} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{LINK_KIND_LABEL[p.kind]}</Badge>
                <code className="break-all text-xs">{p.link}</code>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                In {p.where.type === "menu" ? "the menu" : "the page"} <span className="font-medium text-foreground">{p.where.label}</span>. {p.hint}
              </p>
            </li>
          ))}
        </ul>
      )}
      {problems.some((p) => p.kind === "broken") ? (
        <div className="mt-4">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/settings/redirects" />}>
            Add a redirect
          </Button>
        </div>
      ) : null}
    </SettingsCard>
  );
}

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
          <BrokenLinksCard />
        </>
      )}
    </SettingsPageFrame>
  );
}
