import React, { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CreditCard, Lock } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  MetricCardsSkeleton,
  PageContainer,
  PageHeader,
  Switch,
  toast,
} from "@bs/ui";
import type { PlatformPaymentProviderView } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";
import { messageOf } from "../../lib/errors.ts";
import { useHasRole } from "../../lib/user-context.tsx";

const COPY: Record<PlatformPaymentProviderView["provider"], { blurb: string; accent: string }> = {
  razorpay: {
    blurb: "India payment gateway supporting UPI, Netbanking, Cards, and Wallets.",
    accent: "bg-blue-500/10 text-blue-500",
  },
  stripe: {
    blurb: "Global payment gateway via Stripe-hosted Checkout (redirect to Stripe, no card form on the storefront).",
    accent: "bg-indigo-500/10 text-indigo-500",
  },
};

type Pending =
  | { provider: PlatformPaymentProviderView["provider"]; field: "enabled" | "liveModeAllowed"; value: boolean }
  | null;

export function PaymentsIntegrations() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = useHasRole("platform_admin");
  const [pending, setPending] = useState<Pending>(null);
  const [saving, setSaving] = useState(false);

  const { data: providers, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["platform", "integrations", "payment-providers"],
    queryFn: () => client.integrations.paymentProviders(),
  });

  const apply = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await client.integrations.updatePaymentProvider({ provider: pending.provider, [pending.field]: pending.value });
      toast.success("Payment provider updated");
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: ["platform", "integrations"] });
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const pendingProvider = providers?.find((p) => p.provider === pending?.provider);

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
        title="Payment Gateways"
        description="Enable payment providers for the platform. Stores see only the gateways enabled here, then connect their own account and activate it. Everything runs in test mode until live mode is allowed."
      />

      {isLoading ? <MetricCardsSkeleton count={3} /> : null}
      {isError ? (
        <div role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-foreground">Could not load payment providers</p>
          <p className="text-foreground-2">{messageOf(error)}</p>
          <Button size="sm" className="mt-2" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
        {(providers ?? []).map((p) => (
          <Card key={p.provider} className="flex flex-col justify-between hover:border-primary/40 transition-colors">
            <CardHeader>
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2.5 rounded-lg ${COPY[p.provider].accent}`}>
                  <CreditCard className="h-6 w-6" />
                </div>
                <Badge variant={p.enabled ? "default" : "secondary"}>{p.enabled ? "Enabled" : "Disabled"}</Badge>
              </div>
              <CardTitle className="text-xl">{p.displayName}</CardTitle>
              <CardDescription>{COPY[p.provider].blurb}</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 text-xs">
              <div className="rounded-md border border-border/60 p-3 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-foreground">Platform enablement</div>
                    <div className="text-[11px] text-muted-foreground">Stores can connect and activate it</div>
                  </div>
                  <Switch
                    aria-label={`Enable ${p.displayName} for stores`}
                    checked={p.enabled}
                    onCheckedChange={(checked) => setPending({ provider: p.provider, field: "enabled", value: checked })}
                    disabled={!canEdit}
                  />
                </div>
                <div className="flex items-center justify-between border-t border-border/40 pt-2">
                  <div>
                    <div className="font-semibold text-foreground">Allow live mode</div>
                    <div className="text-[11px] text-muted-foreground">Permit live keys (test keys only until on)</div>
                  </div>
                  <Switch
                    aria-label={`Allow live mode for ${p.displayName}`}
                    checked={p.liveModeAllowed}
                    onCheckedChange={(checked) => setPending({ provider: p.provider, field: "liveModeAllowed", value: checked })}
                    disabled={!canEdit || !p.enabled}
                  />
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-md border border-border/60 p-2">
                  <dt className="text-muted-foreground">Stores with keys</dt>
                  <dd className="text-base font-semibold text-foreground">{p.connectedStores}</dd>
                </div>
                <div className="rounded-md border border-border/60 p-2">
                  <dt className="text-muted-foreground">Stores active</dt>
                  <dd className="text-base font-semibold text-foreground">{p.activeStores}</dd>
                </div>
              </dl>

              <div className="rounded-md border border-border/60 p-2.5 text-[11px] text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Webhook endpoint (set in the provider dashboard)</p>
                <p className="font-mono bg-muted p-1 rounded text-[10px] break-all">
                  https://&lt;store-domain&gt;/api/webhooks/{p.provider}?tenantId=&lt;store-id&gt;
                </p>
                <p>Each store sees its own exact URL in Store Admin &gt; Settings &gt; Payments.</p>
              </div>
            </CardContent>

            <CardFooter className="pt-2">
              <Badge variant="outline" className="w-full justify-center py-1 text-[11px]">
                Stores connect in Store Admin Settings
              </Badge>
            </CardFooter>
          </Card>
        ))}

        <Card className="flex flex-col justify-between opacity-70">
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2.5 rounded-lg bg-muted text-muted-foreground">
                <Lock className="h-6 w-6" />
              </div>
              <Badge variant="secondary">Coming later</Badge>
            </div>
            <CardTitle className="text-xl">PayPal</CardTitle>
            <CardDescription>International digital wallet and buyer payment gateway.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="rounded-md border border-border/60 p-3 text-muted-foreground">
              PayPal is scheduled for a future milestone.
            </div>
          </CardContent>
          <CardFooter className="pt-2">
            <Button variant="outline" disabled className="w-full">
              Coming later
            </Button>
          </CardFooter>
        </Card>
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setPending(null);
        }}
        title={
          pending?.field === "enabled"
            ? `${pending.value ? "Enable" : "Disable"} ${pendingProvider?.displayName ?? "provider"}?`
            : `${pending?.value ? "Allow" : "Block"} live mode for ${pendingProvider?.displayName ?? "provider"}?`
        }
        description={
          pending?.field === "enabled"
            ? pending.value
              ? "Stores will be able to connect their own account and activate it."
              : "Stores stop being able to connect or activate this gateway and it is no longer offered to new customers. Saved keys, payments already in progress and refunds keep working, and live mode is switched off."
            : pending?.value
              ? "Stores will be able to save live keys for this gateway. Only allow this when you are ready for real payments."
              : "Stores will only be able to use test keys for this gateway."
        }
        confirmLabel={saving ? "Saving..." : "Confirm"}
        destructive={pending?.field === "enabled" && pending.value === false}
        pending={saving}
        onConfirm={() => void apply()}
      />
    </PageContainer>
  );
}
