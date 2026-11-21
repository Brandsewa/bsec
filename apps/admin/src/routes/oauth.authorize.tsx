import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Laptop, ShieldAlert, X } from "lucide-react";
import { AuthCardSkeleton, AuthShell, Button, FormSkeleton, SimpleSelect, toast } from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { fetchMe } from "../lib/auth.ts";
import { errorMessage } from "../lib/errors.ts";
import { getActiveStoreId, setActiveStoreId } from "../lib/session.ts";

/**
 * The screen an AI app sends the merchant to (docs/MCP-PLAN.md section 15, S3). The OAuth server (/api/oauth/authorize) has already
 * validated the app and its redirect address and stored the request; this screen only asks the merchant to approve or cancel.
 * Not signed in: the normal sign-in comes first and returns here.
 */
export const Route = createFileRoute("/oauth/authorize")({
  validateSearch: (s: Record<string, unknown>): { request?: string } => (typeof s.request === "string" && /^[0-9a-f-]{36}$/i.test(s.request) ? { request: s.request } : {}),
  pendingComponent: () => <AuthCardSkeleton />,
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 0 }).catch(() => null);
    if (!me) throw redirect({ to: "/login", search: { returnTo: location.href } });
    return { me };
  },
  component: AuthorizePage,
});

function AuthorizePage() {
  const { me } = Route.useRouteContext();
  const { request } = Route.useSearch();
  const saved = getActiveStoreId();
  const [storeId, setStoreId] = useState(() => me.stores.find((s) => s.tenantId === saved)?.tenantId ?? me.stores[0]?.tenantId ?? "");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const store = me.stores.find((s) => s.tenantId === storeId);

  // The server resolves the store from this header, and checks the signed-in user's membership on every call.
  if (storeId && typeof window !== "undefined" && getActiveStoreId() !== storeId) setActiveStoreId(storeId);

  const view = useQuery({
    queryKey: ["ai-authorization", request, storeId],
    queryFn: () => client.admin.ai.authorization.get({ requestId: request ?? "" }),
    enabled: Boolean(request && storeId && !me.support),
    retry: false,
  });

  async function decide(kind: "approve" | "deny") {
    if (!request) return;
    setBusy(kind);
    try {
      const r = kind === "approve" ? await client.admin.ai.authorization.approve({ requestId: request }) : await client.admin.ai.authorization.deny({ requestId: request });
      window.location.assign(r.redirectTo);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(null);
    }
  }

  if (!request) {
    return (
      <AuthShell title="This link is not valid" description="Go back to the AI app and press Connect again.">
        <p className="text-center text-sm text-muted-foreground">The connection request is missing.</p>
      </AuthShell>
    );
  }

  if (me.support) {
    return (
      <AuthShell title="Not available in a support session" description="Support staff cannot connect AI apps to a store.">
        <p className="text-center text-sm text-muted-foreground">The store owner or an admin has to approve this.</p>
      </AuthShell>
    );
  }

  const v = view.data;
  const canManage = (store?.permissions ?? []).includes("ai.manage");
  const goSettings = (path: string) => window.location.assign(path);

  let problem: { title: string; body: string; action?: { label: string; path: string } } | null = null;
  if (view.isError) {
    const message = errorMessage(view.error);
    problem = /expired|not found/i.test(message)
      ? { title: "This link expired", body: "Go back to the AI app and press Connect again." }
      : /permission|forbidden/i.test(message)
        ? { title: "Ask the store owner", body: "Only the owner and admins can connect AI apps to a store." }
        : { title: "Could not load this request", body: message };
  } else if (store && !canManage) {
    problem = { title: "Ask the store owner", body: `Only the owner and admins of ${store.name} can connect AI apps.` };
  } else if (v && !v.store.entitled) {
    problem = { title: "AI access needs the Growth plan", body: `${store?.name ?? "This store"} is on a plan without AI access.`, action: { label: "View plans", path: "/settings/plan-and-billing" } };
  } else if (v && !v.store.available) {
    problem = { title: "AI access is turned off", body: "Brand Sewa has turned AI access off for this store. Contact support if you think this is a mistake." };
  } else if (v && (!v.store.enabled || !v.store.consentAccepted)) {
    problem = {
      title: "Turn on AI access first",
      body: "Open Settings, turn on AI access and accept the terms. Then go back to the AI app and press Connect again.",
      action: { label: "Open AI access settings", path: "/settings/ai-access" },
    };
  }

  const problemAction = problem?.action;

  return (
    <AuthShell
      title={v ? `Connect ${v.clientName} to your store?` : "Connect an AI app?"}
      {...(v ? { description: v.loopback ? "An app running on this computer, such as Claude Code. Its name is chosen by the app." : `The app will return to ${v.redirectHost}. The app's name is chosen by the app and is not verified by Brand Sewa.` } : {})}
    >
      <div className="space-y-5">
        {me.stores.length > 1 ? (
          <div>
            <label htmlFor="authorize-store" className="mb-1 block text-xs font-medium text-foreground">
              Store
            </label>
            <SimpleSelect id="authorize-store" ariaLabel="Store" value={storeId} onChange={setStoreId} options={me.stores.map((s) => ({ value: s.tenantId, label: s.name }))} />
          </div>
        ) : store ? (
          <p className="text-center text-sm text-foreground">
            Store: <span className="font-medium">{store.name}</span>
          </p>
        ) : null}

        {view.isLoading ? <FormSkeleton /> : null}

        {problem ? (
          <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4 text-center">
            <ShieldAlert className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-foreground">{problem.title}</p>
            <p className="text-xs text-muted-foreground">{problem.body}</p>
            {problemAction ? (
              <Button className="w-full" onClick={() => goSettings(problemAction.path)}>
                {problemAction.label}
              </Button>
            ) : null}
            <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => void decide("deny")}>
              Cancel
            </Button>
          </div>
        ) : v ? (
          <>
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">{v.clientName} will be able to:</p>
              <ul className="space-y-1.5">
                {v.store.abilities.length === 0 ? <li className="text-xs text-muted-foreground">Nothing yet. Turn on permissions in Settings &gt; AI access.</li> : null}
                {v.store.abilities.map((line) => (
                  <li key={line} className="flex items-start gap-2 text-xs text-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                    {line}
                  </li>
                ))}
                {v.store.refusals.map((line) => (
                  <li key={line} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <X className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p>
                {v.loopback ? <Laptop className="mr-1.5 inline size-3.5 align-text-bottom" aria-hidden /> : null}
                It acts as <span className="font-medium text-foreground">{me.user.name}</span> and can never do more than you can.
              </p>
              <p>Information the app reads goes to its provider under that provider&rsquo;s terms. You can change permissions or disconnect any time in Settings &gt; AI access.</p>
            </div>
            <div className="flex flex-col-reverse gap-3 sm:grid sm:grid-cols-2">
              <Button variant="outline" size="lg" disabled={busy !== null} loading={busy === "deny"} onClick={() => void decide("deny")}>
                Cancel
              </Button>
              <Button size="lg" disabled={busy !== null || v.store.abilities.length === 0} loading={busy === "approve"} onClick={() => void decide("approve")}>
                Approve and connect
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </AuthShell>
  );
}
