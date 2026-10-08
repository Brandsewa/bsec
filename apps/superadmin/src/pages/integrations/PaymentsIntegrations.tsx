import React, { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
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
  PageContainer,
  PageHeader,
  Switch,
  toast,
} from "@bs/ui";
import { useHasRole } from "../../lib/user-context.tsx";

export function PaymentsIntegrations() {
  const navigate = useNavigate();
  const canEdit = useHasRole("platform_admin");

  // State for switches (in Slice D this will be wired to platform_payment_providers)
  const [razorpayEnabled, setRazorpayEnabled] = useState(true);
  const [razorpayAllowLive, setRazorpayAllowLive] = useState(false);

  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [stripeAllowLive, setStripeAllowLive] = useState(false);

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
        description="Enable platform payment providers. Stores can only connect accounts to gateways enabled here."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
        {/* Razorpay Card */}
        <Card className="flex flex-col justify-between hover:border-primary/40 transition-colors">
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-500">
                <CreditCard className="h-6 w-6" />
              </div>
              <Badge variant={razorpayEnabled ? "default" : "secondary"}>
                {razorpayEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <CardTitle className="text-xl">Razorpay</CardTitle>
            <CardDescription>
              India payment gateway supporting UPI, Netbanking, Cards, and Wallets.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 text-xs">
            <div className="rounded-md border border-border/60 p-3 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground">Platform Enablement</div>
                  <div className="text-[11px] text-muted-foreground">Available for stores to configure</div>
                </div>
                <Switch
                  checked={razorpayEnabled}
                  onCheckedChange={(checked) => {
                    setRazorpayEnabled(checked);
                    toast.info(checked ? "Razorpay enabled for stores" : "Razorpay disabled for stores");
                  }}
                  disabled={!canEdit}
                />
              </div>

              <div className="flex items-center justify-between border-t border-border/40 pt-2">
                <div>
                  <div className="font-semibold text-foreground">Allow Live Mode</div>
                  <div className="text-[11px] text-muted-foreground">Permit stores to enter live credentials</div>
                </div>
                <Switch
                  checked={razorpayAllowLive}
                  onCheckedChange={(checked) => {
                    setRazorpayAllowLive(checked);
                    toast.info(checked ? "Live mode allowed for Razorpay" : "Live mode blocked for Razorpay");
                  }}
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="rounded-md border border-border/60 p-2.5 text-[11px] text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Webhook Endpoint</p>
              <p className="font-mono bg-muted p-1 rounded text-[10px] break-all">
                https://&lt;store-domain&gt;/api/webhooks/razorpay
              </p>
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Badge variant="outline" className="w-full justify-center py-1 text-[11px]">
              Available in Store Admin Settings
            </Badge>
          </CardFooter>
        </Card>

        {/* Stripe Card */}
        <Card className="flex flex-col justify-between hover:border-primary/40 transition-colors">
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-500">
                <CreditCard className="h-6 w-6" />
              </div>
              <Badge variant={stripeEnabled ? "default" : "secondary"}>
                {stripeEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <CardTitle className="text-xl">Stripe</CardTitle>
            <CardDescription>
              Global payment gateway via Stripe-hosted Checkout (redirect).
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 text-xs">
            <div className="rounded-md border border-border/60 p-3 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground">Platform Enablement</div>
                  <div className="text-[11px] text-muted-foreground">Available for stores to configure</div>
                </div>
                <Switch
                  checked={stripeEnabled}
                  onCheckedChange={(checked) => {
                    setStripeEnabled(checked);
                    toast.info(checked ? "Stripe enabled for stores" : "Stripe disabled for stores");
                  }}
                  disabled={!canEdit}
                />
              </div>

              <div className="flex items-center justify-between border-t border-border/40 pt-2">
                <div>
                  <div className="font-semibold text-foreground">Allow Live Mode</div>
                  <div className="text-[11px] text-muted-foreground">Permit stores to enter live credentials</div>
                </div>
                <Switch
                  checked={stripeAllowLive}
                  onCheckedChange={(checked) => {
                    setStripeAllowLive(checked);
                    toast.info(checked ? "Live mode allowed for Stripe" : "Live mode blocked for Stripe");
                  }}
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="rounded-md border border-border/60 p-2.5 text-[11px] text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Webhook Endpoint</p>
              <p className="font-mono bg-muted p-1 rounded text-[10px] break-all">
                https://&lt;store-domain&gt;/api/webhooks/stripe
              </p>
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Badge variant="outline" className="w-full justify-center py-1 text-[11px]">
              Available in Store Admin Settings
            </Badge>
          </CardFooter>
        </Card>

        {/* PayPal Card (Coming later) */}
        <Card className="flex flex-col justify-between opacity-70">
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2.5 rounded-lg bg-muted text-muted-foreground">
                <Lock className="h-6 w-6" />
              </div>
              <Badge variant="secondary">Coming later</Badge>
            </div>
            <CardTitle className="text-xl">PayPal</CardTitle>
            <CardDescription>
              International digital wallet and buyer payment gateway.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3 text-xs">
            <div className="rounded-md border border-border/60 p-3 text-muted-foreground">
              PayPal integration is scheduled for a future milestone. Live credential enrolment is not supported in this
              release.
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Button variant="outline" disabled className="w-full">
              Coming Later
            </Button>
          </CardFooter>
        </Card>
      </div>
    </PageContainer>
  );
}
