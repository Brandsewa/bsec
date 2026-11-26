import { useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Bot, Check, ChevronDown, Copy, Lock, ShieldCheck, Unplug, X } from "lucide-react";
import { Alert, Badge, Button, Checkbox, ConfirmDialog, EmptyState, FormSkeleton, PageSkeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger, toast } from "@bs/ui";
import type { AiSettings } from "@bs/contracts";
import { SettingsCard, SettingsPageFrame } from "../../../components/settings/settings-page.tsx";
import { client } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

type Tab = "connection" | "permissions";

export const Route = createFileRoute("/_store/settings/ai-access")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (s.tab === "permissions" ? { tab: "permissions" } : {}),
  pendingComponent: () => <PageSkeleton />,
  component: AiAccessPage,
});

const TITLE = "AI access";
const DESCRIPTION = "Let an AI assistant such as Claude or Google Antigravity help run your store. You choose what it can see and change.";
const KEY = ["admin", "ai", "settings"] as const;

const RESOURCES: Array<{ id: string; label: string; hint: string }> = [
  { id: "products", label: "Products", hint: "Delete means archive: products can be restored." },
  { id: "categories", label: "Categories", hint: "Delete works only for a hidden category with no products." },
  { id: "collections", label: "Collections", hint: "Delete works only for a collection that is not published." },
  { id: "blog", label: "Blog posts", hint: "Includes blog categories. New posts are drafts. Delete works only for drafts." },
  { id: "pages", label: "Website pages", hint: "Page text, links and sections (saved as drafts) and menus. Delete works only for unpublished pages." },
  { id: "redirects", label: "Redirects", hint: "Old address to a new address on your store." },
  { id: "customers", label: "Customers", hint: "Includes names, email addresses, phone numbers and addresses." },
  { id: "orders", label: "Orders", hint: "" },
  { id: "analytics", label: "Analytics", hint: "" },
  { id: "finance", label: "Finance", hint: "Profit and loss and expenses. The AI can never change the books." },
];
const ACTIONS = ["read", "write", "delete"] as const;

/** The Antigravity mcp_config.json entry: a remote server needs only its address; sign-in uses Antigravity's published identity (CIMD). */
function antigravityConfig(url: string): string {
  return JSON.stringify({ mcpServers: { "my-store": { serverUrl: url } } }, null, 2);
}
const CHANGE_LABELS: Record<string, string> = {
  "product.created": "Created a product (draft)",
  "product.updated": "Edited a product",
  "product.published": "Published a product",
  "product.unpublished": "Unpublished a product",
  "product.archived": "Archived a product",
  "variant.updated": "Changed a variant",
  "inventory.adjusted": "Adjusted stock",
  "collection.created": "Created a collection (unpublished)",
  "collection.updated": "Edited a collection",
  "collection.deleted": "Deleted a collection",
  "category.created": "Created a category (inactive)",
  "category.updated": "Edited a category",
  "category.deleted": "Deleted a category",
  "blog.post.created": "Wrote a blog post (draft)",
  "blog.post.updated": "Edited a blog post",
  "blog.post.published": "Published a blog post",
  "blog.post.unpublished": "Unpublished a blog post",
  "blog.post.deleted": "Deleted a blog post",
  "blog.category.created": "Created a blog category",
  "blog.category.updated": "Edited a blog category",
  "blog.category.deleted": "Deleted a blog category",
  "page.created": "Created a page (draft)",
  "page.updated": "Edited page settings",
  "page.block.updated": "Changed page text or settings (draft)",
  "page.block.added": "Added a page section (draft)",
  "page.block.moved": "Moved a page section (draft)",
  "page.block.removed": "Removed a page section (draft)",
  "page.block.hidden": "Hid or showed a page section (draft)",
  "page.published": "Published a page",
  "page.unpublished": "Unpublished a page",
  "page.deleted": "Deleted a page",
  "menu.created": "Created a menu",
  "menu.updated": "Edited a menu",
  "menu.deleted": "Deleted a menu",
  "redirect.created": "Added a redirect",
  "redirect.updated": "Edited a redirect",
  "redirect.deleted": "Deleted a redirect",
};

function AiAccessPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => client.admin.ai.settings.get(), retry: false });
  const [consentOpen, setConsentOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const update = useMutation({
    mutationFn: (input: Parameters<typeof client.admin.ai.settings.update>[0]) => client.admin.ai.settings.update(input),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      void qc.invalidateQueries({ queryKey: ["admin", "ai", "usage"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (query.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <FormSkeleton />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }
  if (query.isError || !query.data) {
    const message = errorMessage(query.error);
    const noAccess = /permission|forbidden/i.test(message);
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <EmptyState
            icon={noAccess ? Lock : AlertCircle}
            title={noAccess ? "Only the store owner and admins can change AI access" : "Could not load AI access"}
            description={noAccess ? "Ask the owner of the store to open Settings > AI access." : message}
            action={noAccess ? undefined : <Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  const s = query.data;

  if (!s.entitled) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <EmptyState
            icon={Bot}
            title="AI access is on the Growth plan and above"
            description="Upgrade your plan to connect an AI assistant such as Claude to your store."
            action={
              <Button nativeButton={false} render={<Link to="/settings/plan-and-billing" />}>
                View plans
              </Button>
            }
          />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  const needsConsent = s.enabled && !s.consent.accepted;

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {!s.available ? (
        <Alert role="alert">
          <span className="font-medium text-foreground">AI access is turned off for your store by Brand Sewa.</span> Contact support if you think this is a mistake.
        </Alert>
      ) : null}

      <SettingsCard
        title="AI access"
        description="When this is on, AI apps you connect can work in your store within the permissions below."
        actions={
          <Switch
            aria-label="Enable AI access"
            checked={s.enabled}
            disabled={update.isPending || !s.available}
            onCheckedChange={(on) => {
              if (on) {
                setAgreed(false);
                setConsentOpen(true);
              } else {
                setDisableOpen(true);
              }
            }}
          />
        }
      >
        {needsConsent ? (
          <Alert role="alert">
            <span className="font-medium text-foreground">The AI access terms changed.</span> Accept them again to keep AI apps working.{" "}
            <button type="button" className="font-medium text-foreground underline" onClick={() => { setAgreed(false); setConsentOpen(true); }}>
              Review and accept
            </button>
          </Alert>
        ) : (
          <p className="text-xs text-muted-foreground">
            {s.enabled ? "AI access is on. Apps you connect act as the person who approved them, and every change they make is recorded in your activity log." : "Off. No AI app can see or change anything in your store."}
          </p>
        )}
      </SettingsCard>

      <Tabs value={tab ?? "connection"} onValueChange={(v) => void navigate({ to: "/settings/ai-access", search: v === "permissions" ? { tab: "permissions" } : {}, replace: true })}>
        <TabsList>
          <TabsTrigger value="connection">Connection</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
        </TabsList>
        <TabsContent value="connection" className="mt-4 space-y-4">
          <ConnectionTab settings={s} />
        </TabsContent>
        <TabsContent value="permissions" className="mt-4 space-y-4">
          <PermissionsTab settings={s} busy={update.isPending} onChange={(input) => update.mutate(input)} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={consentOpen}
        onOpenChange={setConsentOpen}
        title={s.consent.text.title}
        description={
          <span className="block max-h-[55vh] space-y-3 overflow-y-auto text-left text-sm">
            <span className="block">{s.consent.text.intro}</span>
            <span className="block">
              <span className="block space-y-1">
                {s.consent.text.includes.map((line) => (
                  <span key={line} className={line.startsWith("Customer details") ? "block font-medium text-foreground" : "block"}>
                    {"•"} {line}
                  </span>
                ))}
              </span>
            </span>
            <span className="block space-y-2 text-xs text-muted-foreground">
              {s.consent.text.notes.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </span>
          </span>
        }
        confirmLabel={needsConsent ? "Accept" : "Enable AI access"}
        confirmDisabled={!agreed}
        pending={update.isPending}
        onConfirm={() =>
          update.mutate(
            { ...(needsConsent ? {} : { enabled: true }), acceptConsentVersion: s.consent.currentVersion },
            {
              onSuccess: () => {
                setConsentOpen(false);
                toast.success("AI access is on");
              },
            },
          )
        }
      >
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={agreed} onCheckedChange={(c) => setAgreed(Boolean(c))} aria-label={s.consent.text.checkbox} />
          <span>{s.consent.text.checkbox}</span>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title="Turn off AI access?"
        description="Connected apps stop working straight away. Turning it on again asks you to accept the terms again."
        confirmLabel="Turn off"
        destructive
        pending={update.isPending}
        onConfirm={() =>
          update.mutate(
            { enabled: false },
            {
              onSuccess: () => {
                setDisableOpen(false);
                toast.success("AI access is off");
              },
            },
          )
        }
      />
    </SettingsPageFrame>
  );
}

function ConnectionTab({ settings }: { settings: AiSettings }) {
  const qc = useQueryClient();
  const connections = useQuery({ queryKey: ["admin", "ai", "connections"], queryFn: () => client.admin.ai.connections.list(), enabled: settings.enabled });
  const usage = useQuery({ queryKey: ["admin", "ai", "usage"], queryFn: () => client.admin.ai.usage(), enabled: settings.enabled, refetchInterval: 30_000 });
  const activity = useQuery({ queryKey: ["admin", "ai", "activity"], queryFn: () => client.admin.ai.activity({ limit: 8 }), enabled: settings.enabled });
  const changes = useQuery({ queryKey: ["admin", "ai", "changes"], queryFn: () => client.admin.ai.changes({ limit: 8 }), enabled: settings.enabled });
  const [check, setCheck] = useState<Awaited<ReturnType<typeof client.admin.ai.setupCheck>> | null>(null);
  const [checking, setChecking] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  if (!settings.enabled) {
    return (
      <SettingsCard>
        <EmptyState icon={Bot} title="Turn on AI access to connect an app" description="Use the switch above. You will be asked to read and accept the terms first." />
      </SettingsCard>
    );
  }

  async function copyText(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
    } catch {
      toast.error("Could not copy. Select the text and copy it.");
    }
  }

  const copy = () => copyText(settings.mcpUrl, "Address copied");

  async function runCheck() {
    setChecking(true);
    try {
      setCheck(await client.admin.ai.setupCheck());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  async function revoke() {
    if (!revokeId) return;
    setRevoking(true);
    try {
      await client.admin.ai.connections.revoke({ id: revokeId });
      toast.success("App disconnected");
      setRevokeId(null);
      await qc.invalidateQueries({ queryKey: ["admin", "ai"] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRevoking(false);
    }
  }

  const u = usage.data;
  const limitHit = Boolean(u && (u.callsToday >= u.callLimit || u.writesToday >= u.writeLimit));

  return (
    <>
      <SettingsCard title="Connect an AI app" description="Add your store to Claude or Google Antigravity. It takes about a minute.">
        <div className="grid gap-4">
          <div>
            <label htmlFor="ai-url" className="mb-1 block text-xs font-medium text-foreground">
              Store connector address
            </label>
            <div className="flex items-center gap-2">
              <input id="ai-url" readOnly value={settings.mcpUrl} onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-xs text-foreground" />
              <Button variant="outline" onClick={() => void copy()}>
                <Copy /> Copy
              </Button>
            </div>
          </div>
          <Tabs defaultValue="claude">
            <TabsList>
              <TabsTrigger value="claude">Claude</TabsTrigger>
              <TabsTrigger value="antigravity">Google Antigravity</TabsTrigger>
            </TabsList>
            <TabsContent value="claude" className="mt-3 grid gap-4">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
                <li>In Claude, open Customize, then Connectors, then Add custom connector.</li>
                <li>Paste the address above and press Add.</li>
                <li>Press Connect, sign in to your store here and approve.</li>
              </ol>
              <details className="group rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-foreground">
                  On a Team plan, or using Claude Code?
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="mt-2 space-y-1.5">
                  <p>On Claude Team and Enterprise plans, a workspace Owner adds the connector under Organization settings, then each person presses Connect.</p>
                  <p>In the OAuth step keep &ldquo;Use Claude&rsquo;s published identity&rdquo;. A Free Claude account allows one custom connector.</p>
                  <p>
                    Claude Code: <code className="rounded bg-muted px-1 py-0.5 font-mono">claude mcp add --transport http store {settings.mcpUrl}</code>
                  </p>
                  <p>If sign-in fails, note the reference starting with &ldquo;ofid_&rdquo; that Claude shows and send it to support.</p>
                </div>
              </details>
            </TabsContent>
            <TabsContent value="antigravity" className="mt-3 grid gap-4">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
                <li>In Antigravity open the MCP servers settings: in the app, Customizations, then Installed, then MCP Servers; in the editor, MCP Servers, then Manage MCP Servers, then View raw config.</li>
                <li>Add the lines below to the configuration and save.</li>
                <li>Press Authenticate on the new server, sign in to your store here and approve. Antigravity then shows a code: paste it where Antigravity asks for the authorization code.</li>
              </ol>
              <div className="relative">
                <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">{antigravityConfig(settings.mcpUrl)}</pre>
                <Button variant="outline" size="sm" className="absolute right-2 top-2" onClick={() => void copyText(antigravityConfig(settings.mcpUrl), "Configuration copied")}>
                  <Copy /> Copy
                </Button>
              </div>
              <details className="group rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-foreground">
                  Using the Antigravity CLI, or sign-in does not start?
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="mt-2 space-y-1.5">
                  <p>The CLI and the editor read the same file: <code className="rounded bg-muted px-1 py-0.5 font-mono">~/.gemini/config/mcp_config.json</code>, or <code className="rounded bg-muted px-1 py-0.5 font-mono">.agents/mcp_config.json</code> inside one project.</p>
                  <p>No client ID, secret or API key is needed: Antigravity signs in with its own published identity. Do not paste a token into the file.</p>
                  <p>Use a recent Antigravity version (the editor needs 2.6 or later for this kind of sign-in).</p>
                </div>
              </details>
            </TabsContent>
          </Tabs>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void runCheck()} loading={checking} disabled={checking}>
              <ShieldCheck /> Check my setup
            </Button>
            {check ? <Badge variant="outline" className={check.ok ? "border-primary/40 bg-primary/10 text-primary" : "border-destructive/40 text-destructive"}>{check.ok ? "All checks passed" : "Something needs attention"}</Badge> : null}
          </div>
          {check ? (
            <ul className="divide-y divide-border/60 rounded-md border border-border text-sm">
              {check.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2 px-3 py-2">
                  {c.ok ? <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">{c.label}</span>
                    <span className="block text-xs text-muted-foreground">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </SettingsCard>

      <SettingsCard title="Connected apps" description="Apps that can work in your store right now.">
        {connections.isLoading ? (
          <FormSkeleton />
        ) : (connections.data ?? []).length === 0 ? (
          <EmptyState icon={Unplug} title="No AI apps connected yet" description="Follow the steps above to connect Claude or Google Antigravity." />
        ) : (
          <ul className="divide-y divide-border/60">
            {(connections.data ?? []).map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Bot className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{c.clientName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Approved by {c.approvedBy.name} &middot; connected {new Date(c.connectedAt).toLocaleDateString()} &middot; {c.lastUsedAt ? `last used ${new Date(c.lastUsedAt).toLocaleString()}` : "not used yet"}
                  </p>
                </div>
                {c.paused ? <Badge variant="outline">Paused</Badge> : null}
                <Button variant="outline" size="sm" onClick={() => setRevokeId(c.id)}>
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard title="Usage today" description={u ? `Resets in about ${u.resetsInSeconds >= 3600 ? `${Math.round(u.resetsInSeconds / 3600)} hours` : `${Math.max(1, Math.round(u.resetsInSeconds / 60))} minutes`}.` : undefined}>
        {limitHit ? (
          <Alert role="alert" className="mb-3">
            <span className="font-medium text-foreground">AI limit reached.</span> The AI will be told to wait until it resets.
          </Alert>
        ) : null}
        {u ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Meter label="Calls" value={u.callsToday} max={u.callLimit} />
            <Meter label="Changes" value={u.writesToday} max={u.writeLimit} />
          </div>
        ) : (
          <FormSkeleton />
        )}
        <p className="mt-3 text-xs text-muted-foreground">What an AI app reads goes to its provider under that provider&rsquo;s terms. Brand Sewa does not store it.</p>
      </SettingsCard>

      <SettingsCard title="Recent activity" description="The latest things AI apps did. Changes to products and collections are also in your audit log.">
        {(activity.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
            {(activity.data ?? []).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate font-mono text-xs text-foreground">{a.tool}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className={a.status === "ok" ? "" : "border-destructive/40 text-destructive"}>{a.status.replace("_", " ")}</Badge>
                  {new Date(a.createdAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard title="Changes made by AI" description="What AI apps changed in your store, newest first. The values before each change are kept in your audit log.">
        {(changes.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
            {(changes.data ?? []).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-foreground">
                  <span className="font-medium">{CHANGE_LABELS[c.action] ?? c.action}</span>
                  <span className="text-muted-foreground"> &middot; {c.client ?? "AI app"}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <ConfirmDialog
        open={revokeId !== null}
        onOpenChange={(o) => !o && setRevokeId(null)}
        title="Disconnect this app?"
        description="It stops working immediately. You can connect it again any time."
        confirmLabel="Disconnect"
        destructive
        pending={revoking}
        onConfirm={() => void revoke()}
      />
    </>
  );
}

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {value.toLocaleString()} of {max.toLocaleString()}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <div className={pct >= 90 ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PermissionsTab({ settings, busy, onChange }: { settings: AiSettings; busy: boolean; onChange: (input: Parameters<typeof client.admin.ai.settings.update>[0]) => void }) {
  function toggle(resource: string, action: string, on: boolean) {
    const next: Record<string, Record<string, boolean>> = {};
    for (const [r, row] of Object.entries(settings.matrix)) next[r] = { ...row };
    next[resource] = { ...(next[resource] ?? {}), [action]: on };
    onChange({ matrix: next });
  }
  const productsWrite = ["products", "categories", "collections", "blog", "pages"].some((r) => settings.matrix[r]?.write === true);
  return (
    <>
      <SettingsCard
        title="What AI apps can do"
        description="This is the most any connected app can do. It also needs the person who connected it to have that access themselves. Changes apply straight away."
        actions={
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onChange({ readOnlyPreset: true })}>
            Read-only preset
          </Button>
        }
      >
        <div role="table" aria-label="AI permissions" className="overflow-hidden rounded-md border border-border">
          <div role="row" className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.25rem)] items-center bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)]">
            <span role="columnheader">Resource</span>
            <span role="columnheader" className="text-center">Read</span>
            <span role="columnheader" className="text-center">Write</span>
            <span role="columnheader" className="text-center">Delete</span>
          </div>
          {RESOURCES.map((r) => (
            <div key={r.id} role="row" className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.25rem)] items-center border-t border-border/60 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)]">
              <div role="rowheader" className="min-w-0 pr-2">
                <p className="text-sm font-medium text-foreground">{r.label}</p>
                {r.hint ? <p className="text-[11px] leading-snug text-muted-foreground">{r.hint}</p> : null}
              </div>
              {ACTIONS.map((a) => {
                const kind = settings.cells[r.id]?.[a] ?? "na";
                return (
                  <div key={a} role="cell" className="flex justify-center">
                    {kind === "toggle" ? (
                      <Switch aria-label={`${r.label}, ${a}`} checked={settings.matrix[r.id]?.[a] === true} disabled={busy} onCheckedChange={(on) => toggle(r.id, a, on)} />
                    ) : kind === "soon" ? (
                      <Badge variant="outline" className="text-[10px]">Soon</Badge>
                    ) : kind === "locked" ? (
                      <span title="Locked: the AI can never do this" aria-label={`${r.label}, ${a}: locked`}>
                        <Lock className="size-4 text-muted-foreground" aria-hidden />
                      </span>
                    ) : (
                      <span className="text-muted-foreground" aria-hidden>&ndash;</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Delete means archive for products (they can be restored). Everything else can only be deleted when it is already hidden from shoppers, and the AI must confirm each deletion. Locked means it can never be turned on.</p>
      </SettingsCard>

      <SettingsCard title="Publishing" description="New products, collections, blog posts and page changes made by an AI app are saved as drafts. Turn this on to let it make them visible to shoppers (publishing a page also needs the publish permission of the person who connected the app).">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground">Allow publishing</span>
          <Switch aria-label="Allow publishing" checked={settings.allowPublishing} disabled={busy || !productsWrite} onCheckedChange={(on) => onChange({ allowPublishing: on })} />
        </div>
        {!productsWrite ? <p className="mt-2 text-xs text-muted-foreground">Turn on Write for Products, Categories, Collections, Blog posts or Website pages first.</p> : null}
      </SettingsCard>
    </>
  );
}
