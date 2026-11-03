import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import {
  Badge,
  Button,
  Field,
  MultiSelect,
  PageContainer,
  PageHeader,
  PageSkeleton,
  SimpleSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@bs/ui";
import type { PlatformAppRecord } from "@bs/contracts";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";
import { useHasRole } from "../lib/user-context.tsx";

const VISIBILITY = [
  { value: "private", label: "Private: only the stores chosen below" },
  { value: "public", label: "Public: every store can see and install it" },
];

/** Marketplace (ADR-043): which stores see each app, a global on/off, and a per-store suspension. */
export function Marketplace() {
  const canManage = useHasRole("platform_admin");
  const [busy, setBusy] = useState<string | null>(null);

  const apps = useQuery({ queryKey: ["platform", "marketplace"], queryFn: () => client.marketplace.list() });
  const tenants = useQuery({ queryKey: ["platform", "tenants", "marketplace"], queryFn: () => client.tenants.list({}) });

  async function act(id: string, fn: () => Promise<unknown>, done: string) {
    setBusy(id);
    try {
      await fn();
      toast.success(done);
      await apps.refetch();
    } catch (err) {
      toast.error(messageOf(err, "Could not save the change"));
    } finally {
      setBusy(null);
    }
  }

  if (apps.isLoading) return <PageSkeleton />;

  const storeOptions = (tenants.data ?? []).filter((t) => t.status !== "deleted").map((t) => ({ value: t.id, label: `${t.name} (${t.slug})` }));

  return (
    <PageContainer>
      <PageHeader title="Marketplace" description="Apps stores can install. Choose who sees each app and switch it on or off." />
      {!canManage ? (
        <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" /> Only platform admins can change the marketplace.
        </p>
      ) : null}

      <div className="space-y-6">
        {(apps.data ?? []).map((app: PlatformAppRecord) => (
          <section key={app.key} className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">{app.name}</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{app.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{app.installCount} installed</Badge>
                <Button
                  size="sm"
                  variant={app.enabled ? "outline" : "default"}
                  disabled={!canManage || busy === app.key}
                  onClick={() => void act(app.key, () => client.marketplace.update({ key: app.key, enabled: !app.enabled }), app.enabled ? `${app.name} turned off for every store` : `${app.name} turned on`)}
                >
                  {app.enabled ? "Turn off everywhere" : "Turn on"}
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field id={`vis-${app.key}`} label="Who can see it">
                <SimpleSelect
                  value={app.visibility}
                  onChange={(visibility) => {
                    if (!canManage) return;
                    void act(app.key, () => client.marketplace.update({ key: app.key, visibility: visibility as "public" | "private" }), "Visibility updated");
                  }}
                  options={VISIBILITY}
                />
              </Field>
              {app.visibility === "private" ? (
                <Field id={`allowed-${app.key}`} label="Stores that can see it">
                  <MultiSelect
                    options={storeOptions}
                    value={app.allowedTenantIds}
                    onChange={(ids) => {
                      if (!canManage) return;
                      void act(app.key, () => client.marketplace.update({ key: app.key, allowedTenantIds: ids }), "Store list updated");
                    }}
                    placeholder="Choose stores"
                  />
                </Field>
              ) : null}
            </div>

            <h3 className="mt-6 text-sm font-medium text-foreground">Stores using it</h3>
            {app.installs.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No store has installed this app yet.</p>
            ) : (
              <div className="mt-2 overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Store</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {app.installs.map((i) => (
                      <TableRow key={i.tenantId}>
                        <TableCell className="font-medium">{i.tenantSlug}</TableCell>
                        <TableCell>
                          {i.suspended ? <Badge variant="outline" className="border-destructive/40 text-destructive">Turned off by you</Badge> : <Badge variant="outline">{i.status === "installed" ? "On" : "Off"}</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canManage || busy === `${app.key}:${i.tenantId}`}
                            onClick={() =>
                              void act(
                                `${app.key}:${i.tenantId}`,
                                () => client.marketplace.setSuspended({ key: app.key, tenantId: i.tenantId, suspended: !i.suspended }),
                                i.suspended ? `${app.name} restored for ${i.tenantSlug}` : `${app.name} turned off for ${i.tenantSlug}`,
                              )
                            }
                          >
                            {i.suspended ? "Restore" : "Turn off for this store"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        ))}
      </div>
    </PageContainer>
  );
}
