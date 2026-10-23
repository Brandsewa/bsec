import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { Badge, Button, ConfirmDialog, FormSkeleton, InfoTip, Input, Switch, toast } from "@bs/ui";
import { SettingsCard } from "./settings-page.tsx";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

function CopyLine({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1">
      <code className="flex-1 break-all text-xs">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Copy ${value}`}
        onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success("Copied"))}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/**
 * Google sign-in for the store's customers, using the store's OWN Google app on its OWN domain
 * (docs/GOOGLE-SIGNIN-PLAN.md, Tier B). Nothing here uses a platform Google client.
 */
export function GoogleSigninCard() {
  const queryClient = useQueryClient();
  const query = useQuery(orpc.admin.socialAuth.get.queryOptions());
  const [clientId, setClientId] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.socialAuth.key() });

  // The test runs in another tab on the store's domain; pick the result up when the owner comes back.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onError = (err: unknown) => toast.error(errorMessage(err));
  const setId = useMutation(
    orpc.admin.socialAuth.setClientId.mutationOptions({
      onSuccess: () => {
        toast.success("Client ID saved. Run the test sign-in next.");
        setClientId(null);
        void refresh();
      },
      onError,
    }),
  );
  const update = useMutation(
    orpc.admin.socialAuth.update.mutationOptions({
      onSuccess: () => {
        toast.success("Saved");
        void refresh();
      },
      onError,
    }),
  );
  const start = useMutation(
    orpc.admin.socialAuth.startVerification.mutationOptions({
      onSuccess: ({ url }) => {
        window.open(url, "_blank", "noopener");
      },
      onError,
    }),
  );
  const disconnect = useMutation(
    orpc.admin.socialAuth.disconnect.mutationOptions({
      onSuccess: () => {
        toast.success("Google sign-in disconnected");
        setConfirmDisconnect(false);
        void refresh();
      },
      onError,
    }),
  );

  const title = "Sign in with Google";
  const description = "Let your customers sign in with their Google account, using your own Google app on your own domain.";

  if (query.isLoading) {
    return (
      <SettingsCard title={title} description={description}>
        <FormSkeleton />
      </SettingsCard>
    );
  }
  const d = query.data;
  if (query.isError || !d) {
    return (
      <SettingsCard title={title} description={description}>
        <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
      </SettingsCard>
    );
  }

  if (!d.platformAllowed) {
    return (
      <SettingsCard title={title} description={description}>
        <Badge variant="outline" className="text-muted-foreground">
          Not available yet
        </Badge>
      </SettingsCard>
    );
  }

  if (!d.hasVerifiedDomain) {
    return (
      <SettingsCard title={title} description={description}>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Connect and verify your own domain first. Google sign-in for customers runs on your domain, so it can show your brand.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/settings/domains">Connect your domain</Link>
          </Button>
        </div>
      </SettingsCard>
    );
  }

  const typedId = (clientId ?? d.clientId ?? "").trim();
  const status = d.verified ? (
    <Badge variant="default">Test passed</Badge>
  ) : d.clientId ? (
    <Badge variant="secondary">Needs a test</Badge>
  ) : (
    <Badge variant="outline">Not set up</Badge>
  );

  return (
    <SettingsCard title={title} description={description} actions={d.enabled && d.verified ? <Badge variant="default">On</Badge> : status}>
      <div className="space-y-5">
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            1. Create your Google app
            <InfoTip>
              In Google Cloud, create an OAuth client of type Web application. Set the consent screen to External and publish it to Production, with only
              the openid, email and profile scopes. If it stays in Testing, only listed test users can sign in. Paste the addresses below as Authorized
              JavaScript origins.
            </InfoTip>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href="https://console.cloud.google.com/apis/credentials/oauthclient" target="_blank" rel="noopener noreferrer">
              Open Google Cloud <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">Authorized JavaScript origins</p>
          {d.origins.map((o) => (
            <CopyLine key={o} value={o} />
          ))}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            2. Paste your Client ID
            <InfoTip>Only the Client ID is needed. Your Google client secret is never asked for or stored.</InfoTip>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Google Client ID"
              placeholder="123456789-abc.apps.googleusercontent.com"
              value={clientId ?? d.clientId ?? ""}
              onChange={(e) => setClientId(e.target.value)}
            />
            <Button
              type="button"
              onClick={() => setId.mutate({ clientId: typedId })}
              disabled={setId.isPending || !typedId || typedId === d.clientId}
              loading={setId.isPending}
            >
              Save
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            3. Test it on your domain
            <InfoTip>
              Opens your store&apos;s own domain in a new tab where you sign in once with Google. No customer is created. Come back here afterwards.
            </InfoTip>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => start.mutate({})} disabled={!d.clientId || start.isPending} loading={start.isPending}>
            Test sign-in
          </Button>
          {d.verified && d.verifiedAt ? (
            <p className="text-xs text-muted-foreground">
              Passed on {d.verifiedHost} · {new Date(d.verifiedAt).toLocaleString()}
            </p>
          ) : null}
        </section>

        <section className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Show Sign in with Google to customers</div>
              <p className="text-xs text-muted-foreground">Needs a passing test. Email sign-in always stays available.</p>
            </div>
            <Switch
              aria-label="Show Sign in with Google to customers"
              checked={d.enabled && d.verified}
              disabled={update.isPending || (!d.verified && !d.enabled)}
              onCheckedChange={(checked) => update.mutate({ enabled: Boolean(checked) })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              Show One Tap on the sign-in page
              <InfoTip>The floating Google prompt. It appears only on the customer sign-in page, never on other pages.</InfoTip>
            </div>
            <Switch
              aria-label="Show One Tap on the sign-in page"
              checked={d.oneTapEnabled}
              disabled={update.isPending || !d.clientId}
              onCheckedChange={(checked) => update.mutate({ oneTapEnabled: Boolean(checked) })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Google&apos;s sign-in script loads on your sign-in page, so mention Google in your privacy policy.
          </p>
          {d.clientId ? (
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDisconnect(true)}>
              Disconnect Google
            </Button>
          ) : null}
        </section>
      </div>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Google sign-in?"
        description="Customers can no longer sign in with Google. Accounts already linked to Google keep working with email sign-in."
        confirmLabel="Disconnect"
        destructive
        pending={disconnect.isPending}
        onConfirm={() => disconnect.mutate({})}
      />
    </SettingsCard>
  );
}
