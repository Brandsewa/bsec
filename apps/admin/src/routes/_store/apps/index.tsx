import { useState } from "react";
import { Link, createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Search } from "lucide-react";
import { Alert, Badge, Button, EmptyState, Input, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { client, orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { appHref, appIcon, isAppOn } from "../../../lib/app-meta.ts";

export const Route = createFileRoute("/_store/apps/")({
  pendingComponent: () => <PageSkeleton />,
  component: AppsHome,
});

/** App home: every app available to this store, with install and open. Installed apps are managed in Settings > Apps. */
function AppsHome() {
  const { store } = useRouteContext({ from: "/_store" });
  const canManage = (store?.permissions ?? []).includes("apps.manage");
  const query = useQuery(orpc.admin.apps.list.queryOptions());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function install(key: string, name: string) {
    setBusy(key);
    try {
      await client.admin.apps.install({ key });
      toast.success(`${name} installed`);
      await query.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (query.isLoading) return <PageSkeleton />;
  if (query.isError || !query.data) {
    return (
      <PageContainer>
        <EmptyState icon={AlertCircle} title="Could not load apps" description={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>Try again</Button>} />
      </PageContainer>
    );
  }

  const term = search.trim().toLowerCase();
  const apps = query.data.filter((a) => !term || a.name.toLowerCase().includes(term) || a.description.toLowerCase().includes(term) || a.category.toLowerCase().includes(term));

  return (
    <PageContainer>
      <PageHeader title="Apps" description="Add features to your store. Install an app, then open it from here, from Settings > Apps, or pin it to the sidebar." />
      {!canManage ? <Alert role="alert">Only store owners and administrators can install or change apps.</Alert> : null}
      <div className="relative mb-5 max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input aria-label="Search apps" className="pl-8" placeholder="Search apps" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {apps.length === 0 ? (
        <EmptyState title={query.data.length === 0 ? "No apps available yet" : "No apps match your search"} description={query.data.length === 0 ? "Apps made available to your store will appear here." : "Try a different word."} />
      ) : (
        <ul className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
          {apps.map((app) => {
            const Icon = appIcon(app.icon);
            const on = isAppOn(app);
            const href = appHref(app.key);
            return (
              <li key={app.key} className="flex gap-3 rounded-lg border border-border bg-background p-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                  <Icon className="size-6" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-foreground">{app.name}</h2>
                    {app.suspended ? <Badge variant="outline" className="border-destructive/40 text-destructive">Turned off by Brand Sewa</Badge> : on ? <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">Installed</Badge> : app.installed ? <Badge variant="outline">Off</Badge> : null}
                  </div>
                  <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{app.description}</p>
                  <p className="mt-2 text-xs capitalize text-muted-foreground">{app.category} · Free</p>
                  <div className="mt-3 flex gap-2">
                    {app.suspended ? null : !app.installed ? (
                      canManage ? (
                        <Button size="sm" disabled={busy === app.key} onClick={() => void install(app.key, app.name)}>
                          Install
                        </Button>
                      ) : null
                    ) : href && on ? (
                      <Button size="sm" asChild>
                        <Link to={href}>Open</Link>
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/settings/apps">Manage</Link>
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
