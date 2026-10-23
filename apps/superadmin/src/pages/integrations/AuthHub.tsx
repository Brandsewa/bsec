import React, { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, KeyRound, Mail, Phone, ShieldCheck, Users } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  InfoTip,
  Input,
  Label,
  MetricCardsSkeleton,
  PageContainer,
  PageHeader,
  Switch,
  toast,
} from "@bs/ui";
import type { PlatformAuthOverview } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";
import { messageOf } from "../../lib/errors.ts";
import { useHasRole } from "../../lib/user-context.tsx";

/** The exact values to paste into Google Cloud, derived from where this app is running. */
function googleSetupValues() {
  const { protocol, hostname } = window.location;
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  if (local) {
    return {
      origins: [`${protocol}//${hostname}:5173`, `${protocol}//${hostname}:5174`, `${protocol}//${hostname}:3000`],
      redirects: [`${protocol}//${hostname}:3000/api/auth/callback/google`, `${protocol}//${hostname}:4000/api/auth/callback/google`],
    };
  }
  const root = hostname.startsWith("superadmin.") ? hostname.slice("superadmin.".length) : hostname;
  return {
    origins: [`${protocol}//${root}`, `${protocol}//admin.${root}`, `${protocol}//superadmin.${root}`],
    redirects: [`${protocol}//${root}/api/auth/callback/google`, `${protocol}//platform.${root}/api/auth/callback/google`],
  };
}

function CopyLine({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1">
      <code className="flex-1 break-all text-[11px]">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Copy ${value}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => toast.success("Copied"));
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

type PendingSwitch = { field: "enabled" | "staffSignupAllowed" | "oneTapAllowed" | "customerSigninAllowed"; value: boolean } | null;

const SWITCH_COPY: Record<NonNullable<PendingSwitch>["field"], { title: string; on: string; off: string }> = {
  enabled: {
    title: "Google sign-in for staff and store owners",
    on: "Super Admin staff and store owners will see Continue with Google on the sign-in pages.",
    off: "The Google button disappears from every sign-in page. Existing Google links are kept, and everyone can still use email and password.",
  },
  staffSignupAllowed: {
    title: "Store owner signup with Google",
    on: "New store owners can create their account with Google on the signup page.",
    off: "New store owners must sign up with email and password.",
  },
  oneTapAllowed: {
    title: "One Tap on the admin sign-in page",
    on: "Returning staff and owners get the Google One Tap prompt on the sign-in page.",
    off: "The One Tap prompt is hidden; the Continue with Google button stays.",
  },
  customerSigninAllowed: {
    title: "Google sign-in for store customers",
    on: "Stores with a verified custom domain can set up their own Google app so their customers can sign in with Google.",
    off: "Stores can no longer offer Google sign-in to their customers. Customers keep email and password.",
  },
};

export function AuthHub() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = useHasRole("platform_admin");
  const [pending, setPending] = useState<PendingSwitch>(null);
  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState("");
  const [savingClient, setSavingClient] = useState(false);
  const [testing, setTesting] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery<PlatformAuthOverview>({
    queryKey: ["platform", "integrations", "auth"],
    queryFn: () => client.integrations.authOverview(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform", "integrations", "auth"] });

  const applySwitch = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await client.integrations.updateGoogleAuth({ [pending.field]: pending.value });
      toast.success("Saved");
      setPending(null);
      await refresh();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const saveClient = async () => {
    const id = (clientId ?? data?.google.clientId ?? "").trim();
    setSavingClient(true);
    try {
      await client.integrations.setGoogleClient({ clientId: id, ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}) });
      toast.success("Google client saved. Run the connection test next.");
      setClientSecret("");
      setClientId(null);
      await refresh();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSavingClient(false);
    }
  };

  const testClient = async () => {
    setTesting(true);
    try {
      const res = await client.integrations.testGoogleClient();
      if (res.ok) toast.success("Google accepted the Client ID and Secret");
      else toast.error(res.error ?? "The connection test failed");
      await refresh();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setTesting(false);
    }
  };

  const g = data?.google;
  const setup = googleSetupValues();
  const testBadge =
    g?.lastTestStatus === "success" ? (
      <Badge variant="default">Test passed</Badge>
    ) : g?.lastTestStatus === "failed" ? (
      <Badge variant="destructive">Test failed</Badge>
    ) : (
      <Badge variant="secondary">Not tested</Badge>
    );

  return (
    <PageContainer>
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => navigate({ to: "/integrations" })}
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Integrations</span>
        </Button>
      </div>

      <PageHeader
        title="Authentication"
        description="How people sign in: email and password, phone OTP, and social sign-in. More sign-in options will be added here."
      />

      {isLoading ? <MetricCardsSkeleton count={3} /> : null}
      {isError ? (
        <div role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-foreground">Could not load authentication settings</p>
          <p className="text-foreground-2">{messageOf(error)}</p>
          <Button size="sm" className="mt-2" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      {data && g ? (
        <div className="mt-4 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Email */}
            <Card>
              <CardHeader>
                <div className="mb-2 flex items-center justify-between">
                  <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
                    <Mail className="h-6 w-6" />
                  </div>
                  <Badge variant={data.email.mailerConfigured ? "default" : "secondary"}>
                    {data.email.mailerConfigured ? "Mailer active" : "Mailer not configured"}
                  </Badge>
                </div>
                <CardTitle className="text-xl">Email and password</CardTitle>
                <CardDescription>The baseline sign-in for every store and every customer.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Stores</span>
                    <span className="font-semibold">{data.email.totalStores}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Stores that turned it off</span>
                    <span className="font-semibold">{data.email.storesDisabled}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => navigate({ to: "/integrations/notifications/email" })}>
                  Open the email mailer
                </Button>
              </CardContent>
            </Card>

            {/* Phone */}
            <Card>
              <CardHeader>
                <div className="mb-2 flex items-center justify-between">
                  <div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-500">
                    <Phone className="h-6 w-6" />
                  </div>
                  <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                    SMS not enrolled
                  </Badge>
                </div>
                <CardTitle className="text-xl">Phone OTP</CardTitle>
                <CardDescription>One-time codes by SMS. Planned as a premium-customer option later.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Stores</span>
                    <span className="font-semibold">{data.phone.totalStores}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Stores that turned it off</span>
                    <span className="font-semibold">{data.phone.storesDisabled}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Social: Google */}
          <Card>
            <CardHeader>
              <div className="mb-2 flex items-center justify-between">
                <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-500">
                  <KeyRound className="h-6 w-6" />
                </div>
                <Badge variant={g.enabled ? "default" : "secondary"}>{g.enabled ? "Enabled" : "Disabled"}</Badge>
              </div>
              <CardTitle className="text-xl">Social sign-in: Google</CardTitle>
              <CardDescription>
                Two separate things. The platform Google app below signs in our own team and store owners. Store customers never use it: each store
                connects its own Google app.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Tier A */}
              <section className="space-y-4 rounded-md border border-border/60 p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Platform sign-in: Super Admin staff and store owners</h3>
                  <InfoTip>
                    Create one OAuth client in Google Cloud (Web application). Paste the origins and redirect URIs shown below. Set the consent screen to
                    External, publish it to Production, and use only the openid, email and profile scopes. Super Admin accounts that use an authenticator
                    app cannot use Google; they keep password plus authenticator.
                  </InfoTip>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="g-client-id">Client ID</Label>
                    <Input
                      id="g-client-id"
                      placeholder="123456789-abc.apps.googleusercontent.com"
                      value={clientId ?? g.clientId ?? ""}
                      onChange={(e) => setClientId(e.target.value)}
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="g-client-secret">Client Secret</Label>
                    <Input
                      id="g-client-secret"
                      type="password"
                      autoComplete="off"
                      placeholder={g.secretConfigured ? "Saved. Type to replace it." : "GOCSPX-…"}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      disabled={!canEdit}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => void saveClient()} disabled={!canEdit || savingClient || !(clientId ?? g.clientId)} loading={savingClient}>
                    Save client
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void testClient()} disabled={!canEdit || testing || !g.clientId || !g.secretConfigured} loading={testing}>
                    Test connection
                  </Button>
                  {testBadge}
                  {g.lastTestStatus === "failed" && g.lastTestError ? <span className="text-xs text-destructive">{g.lastTestError}</span> : null}
                </div>

                <div className="space-y-3 text-[11px]">
                  <p className="font-medium text-foreground">Authorized JavaScript origins</p>
                  {setup.origins.map((o) => (
                    <CopyLine key={o} value={o} />
                  ))}
                  <p className="font-medium text-foreground">Authorized redirect URIs</p>
                  {setup.redirects.map((o) => (
                    <CopyLine key={o} value={o} />
                  ))}
                </div>

                <div className="space-y-3 border-t border-border/40 pt-3 text-xs">
                  <SwitchRow
                    label="Enable Google sign-in"
                    hint="Needs a saved client and a passing connection test."
                    checked={g.enabled}
                    disabled={!canEdit || (!g.enabled && g.lastTestStatus !== "success")}
                    onChange={(value) => setPending({ field: "enabled", value })}
                  />
                  <SwitchRow
                    label="Let new store owners sign up with Google"
                    hint="Shown on the signup page once Google sign-in is enabled."
                    checked={g.staffSignupAllowed}
                    disabled={!canEdit}
                    onChange={(value) => setPending({ field: "staffSignupAllowed", value })}
                  />
                  <SwitchRow
                    label="Show One Tap on the sign-in pages"
                    hint="The floating Google prompt for returning staff and owners."
                    checked={g.oneTapAllowed}
                    disabled={!canEdit}
                    onChange={(value) => setPending({ field: "oneTapAllowed", value })}
                  />
                  <p className="text-muted-foreground">
                    {g.linkedUsers} {g.linkedUsers === 1 ? "person has" : "people have"} linked a Google account.
                  </p>
                </div>
              </section>

              {/* Tier B */}
              <section className="space-y-4 rounded-md border border-border/60 p-4">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Customer sign-in: each store uses its own Google app</h3>
                  <InfoTip>
                    A store must first verify its own custom domain, then create its own Google app and paste the Client ID in Store Admin. The platform
                    stores only that public Client ID and never sees a customer&apos;s Google account. No platform Client ID is involved here.
                  </InfoTip>
                </div>
                <SwitchRow
                  label="Allow stores to offer Google sign-in to their customers"
                  hint="Only stores with a verified custom domain can use it."
                  checked={g.customerSigninAllowed}
                  disabled={!canEdit}
                  onChange={(value) => setPending({ field: "customerSigninAllowed", value })}
                />
                <p className="text-xs text-muted-foreground">
                  {g.customerStoresConnected} {g.customerStoresConnected === 1 ? "store has" : "stores have"} connected their own Google app.
                </p>
              </section>

              <p className="text-xs text-muted-foreground">Facebook and Apple sign-in: coming later.</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setPending(null);
        }}
        title={pending ? `${pending.value ? "Turn on" : "Turn off"}: ${SWITCH_COPY[pending.field].title}?` : ""}
        description={pending ? (pending.value ? SWITCH_COPY[pending.field].on : SWITCH_COPY[pending.field].off) : ""}
        confirmLabel={pending?.value ? "Turn on" : "Turn off"}
        pending={saving}
        destructive={pending?.value === false}
        onConfirm={() => void applySwitch()}
      />
    </PageContainer>
  );
}

function SwitchRow(props: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="font-semibold text-foreground">{props.label}</div>
        <div className="text-[11px] text-muted-foreground">{props.hint}</div>
      </div>
      <Switch aria-label={props.label} checked={props.checked} onCheckedChange={props.onChange} disabled={props.disabled} />
    </div>
  );
}
