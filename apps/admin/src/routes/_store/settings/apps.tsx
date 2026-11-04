import { useState } from "react";
import { Link, createFileRoute, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ExternalLink, MoreHorizontal, Pin, PinOff, Power, Trash2 } from "lucide-react";
import { Alert, Badge, Button, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, PageSkeleton, Tabs, TabsContent, TabsList, TabsTrigger, toast } from "@bs/ui";
import type { StoreAppRecord } from "@bs/contracts";
import { SettingsCard, SettingsPageFrame } from "../../../components/settings/settings-page.tsx";
import { client, orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { appHref, appIcon, isAppOn } from "../../../lib/app-meta.ts";

export const Route = createFileRoute("/_store/settings/apps")({
  pendingComponent: () => <PageSkeleton />,
  component: AppsSettingsPage,
});

const TITLE = "Apps";
const DESCRIPTION = "The apps installed on your store, and the ones you can still add.";

function AppsSettingsPage() {
  const { store } = useRouteContext({ from: "/_store" });
  const canManage = (store?.permissions ?? []).includes("apps.manage");
  const navigate = useNavigate();
  const query = useQuery(orpc.admin.apps.list.queryOptions());
  const [busy, setBusy] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<StoreAppRecord | null>(null);

  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(done);
      await query.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (query.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <PageSkeleton />
      </SettingsPageFrame>
    );
  }
  if (query.isError || !query.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <EmptyState icon={AlertCircle} title="Could not load apps" description={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>Try again</Button>} />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  const installed = query.data.filter((a) => a.installed);
  const available = query.data.filter((a) => !a.installed);

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {!canManage ? (
        <Alert role="alert">
          <span className="font-medium text-foreground">Read-only view:</span> Only store owners and administrators can install or change apps.
        </Alert>
      ) : null}

      <Tabs defaultValue="installed">
        <TabsList>
          <TabsTrigger value="installed">Installed ({installed.length})</TabsTrigger>
          <TabsTrigger value="uninstalled">Uninstalled ({available.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4">
          <SettingsCard>
            {installed.length === 0 ? (
              <EmptyState title="No apps installed" description="Browse the app home to find apps for your store." action={<Button asChild><Link to="/apps">Browse apps</Link></Button>} />
            ) : (
              <ul className="divide-y divide-border">
                {installed.map((app) => {
                  const Icon = appIcon(app.icon);
                  const on = isAppOn(app);
                  const href = appHref(app.key);
                  return (
                    <li key={app.key} className="flex items-center gap-3 py-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        {href && on ? (
                          <Link to={href} className="truncate text-sm font-medium text-foreground hover:underline">{app.name}</Link>
                        ) : (
                          <span className="truncate text-sm font-medium text-foreground">{app.name}</span>
                        )}
                        <p className="truncate text-xs text-muted-foreground">{app.description}</p>
                      </div>
                      {app.pinned ? <Badge variant="outline" className="hidden sm:inline-flex">Pinned</Badge> : null}
                      {app.suspended ? <Badge variant="outline" className="border-destructive/40 text-destructive">Turned off by Brand Sewa</Badge> : on ? <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">On</Badge> : <Badge variant="outline">Off</Badge>}
                      {canManage && !app.suspended ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${app.name}`} disabled={busy === app.key} />}>
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-48">
                            {href && on ? (
                              <DropdownMenuItem onClick={() => void navigate({ to: href })}>
                                <ExternalLink /> Open app
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              onClick={() => void run(app.key, () => client.admin.apps.setPinned({ key: app.key, pinned: !app.pinned }), app.pinned ? `${app.name} unpinned` : `${app.name} pinned to the sidebar`)}
                            >
                              {app.pinned ? <PinOff /> : <Pin />} {app.pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void run(app.key, () => client.admin.apps.setStatus({ key: app.key, status: on ? "disabled" : "installed" }), on ? `${app.name} turned off` : `${app.name} turned on`)}
                            >
                              <Power /> {on ? "Turn off" : "Turn on"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setUninstallTarget(app)}>
                              <Trash2 /> Uninstall
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </SettingsCard>
        </TabsContent>

        <TabsContent value="uninstalled" className="mt-4">
          <SettingsCard>
            {available.length === 0 ? (
              <EmptyState title="Nothing left to install" description="Every app available to your store is already installed." />
            ) : (
              <ul className="divide-y divide-border">
                {available.map((app) => {
                  const Icon = appIcon(app.icon);
                  return (
                    <li key={app.key} className="flex items-center gap-3 py-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium text-foreground">{app.name}</span>
                        <p className="truncate text-xs text-muted-foreground">{app.description}</p>
                      </div>
                      {canManage ? (
                        <Button size="sm" disabled={busy === app.key} onClick={() => void run(app.key, () => client.admin.apps.install({ key: app.key }), `${app.name} installed`)}>
                          Install
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </SettingsCard>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={uninstallTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUninstallTarget(null);
        }}
        title={`Uninstall ${uninstallTarget?.name ?? "app"}?`}
        description="The app stops working on your store. The data it saved, such as state prices, is kept and used again if you install it later."
        confirmLabel="Uninstall"
        onConfirm={async () => {
          if (!uninstallTarget) return;
          const target = uninstallTarget;
          setUninstallTarget(null);
          await run(target.key, () => client.admin.apps.uninstall({ key: target.key }), `${target.name} uninstalled`);
        }}
      />
    </SettingsPageFrame>
  );
}
