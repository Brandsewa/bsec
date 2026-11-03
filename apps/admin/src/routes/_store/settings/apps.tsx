import { useState } from "react";
import { Link, createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, MapPin, Puzzle } from "lucide-react";
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Field, PageSkeleton, SimpleSelect, toast } from "@bs/ui";
import type { StoreAppRecord } from "@bs/contracts";
import { SettingsCard, SettingsPageFrame } from "../../../components/settings/settings-page.tsx";
import { client, orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/apps")({
  pendingComponent: () => <PageSkeleton />,
  component: AppsPage,
});

const TITLE = "Apps";
const DESCRIPTION = "Add features to your store. Install an app, then change its settings here.";

const STATE_PRICING = "state-pricing";

const MODE_OPTIONS = [
  { value: "auto", label: "Automatic: detect the shopper's state" },
  { value: "manual", label: "Manual: ask the shopper for their pincode" },
];

function AppsPage() {
  const { store } = useRouteContext({ from: "/_store" });
  const canManage = (store?.permissions ?? []).includes("apps.manage");
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

  const apps = query.data;

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {!canManage ? (
        <Alert role="alert">
          <span className="font-medium text-foreground">Read-only view:</span> Only store owners and administrators can install or change apps.
        </Alert>
      ) : null}

      {apps.length === 0 ? (
        <SettingsCard>
          <EmptyState icon={Puzzle} title="No apps available yet" description="Apps made available to your store will appear here." />
        </SettingsCard>
      ) : (
        apps.map((app) => {
          const active = app.installed && app.status === "installed" && !app.suspended;
          return (
            <SettingsCard key={app.key} title={app.name} description={app.description}>
              <div className="flex flex-wrap items-center gap-2">
                {app.suspended ? (
                  <Badge variant="outline" className="border-destructive/40 text-destructive">Turned off by Brand Sewa</Badge>
                ) : active ? (
                  <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">On</Badge>
                ) : app.installed ? (
                  <Badge variant="outline">Off</Badge>
                ) : (
                  <Badge variant="outline">Not installed</Badge>
                )}
              </div>

              {app.key === STATE_PRICING && app.installed && !app.suspended ? (
                <div className="mt-4 max-w-md">
                  <Field id="state-pricing-mode" label="How to find the shopper's state">
                    <SimpleSelect
                      value={String(app.settings.mode ?? "auto")}
                      onChange={(mode) => void run(app.key, () => client.admin.apps.updateSettings({ key: app.key, settings: { mode } }), "Settings saved")}
                      options={MODE_OPTIONS}
                    />
                  </Field>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Automatic uses the shopper's location from their connection. Manual shows a pincode box as soon as the store opens, and the price follows the pincode they enter.
                  </p>
                </div>
              ) : null}

              {canManage && !app.suspended ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {!app.installed ? (
                    <Button size="sm" disabled={busy === app.key} onClick={() => void run(app.key, () => client.admin.apps.install({ key: app.key }), `${app.name} installed`)}>
                      Install
                    </Button>
                  ) : (
                    <>
                      {app.key === STATE_PRICING ? (
                        <Button size="sm" asChild>
                          <Link to="/settings/apps/state-pricing">
                            <MapPin className="mr-1.5 h-3.5 w-3.5" /> Set state prices <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === app.key}
                        onClick={() =>
                          void run(
                            app.key,
                            () => client.admin.apps.setStatus({ key: app.key, status: active ? "disabled" : "installed" }),
                            active ? `${app.name} turned off` : `${app.name} turned on`,
                          )
                        }
                      >
                        {active ? "Turn off" : "Turn on"}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === app.key} onClick={() => setUninstallTarget(app)}>
                        Uninstall
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </SettingsCard>
          );
        })
      )}

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
