import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Badge, Button, MetricCardsSkeleton, PageContainer, PageHeader } from "@bs/ui";
import { client } from "../../lib/orpc.ts";
import { messageOf } from "../../lib/errors.ts";
import { useHasRole } from "../../lib/user-context.tsx";
import {
  CashfreeKeysCard,
  CashfreePlansCard,
  GATEWAY_NAME,
  KeysCard,
  PayPalKeysCard,
  PayPalPlansCard,
  PlansCard,
  WebhookDeliveriesCard,
  WebhookUrlCard,
} from "./billing/cards.tsx";

const BLURB = {
  razorpay: "The national gateway for Indian stores (INR). Recurring subscriptions through Razorpay plans.",
  cashfree: "The national gateway for Indian stores (INR). UPI AutoPay and card subscriptions through Cashfree.",
  paypal: "The international gateway for stores outside India (USD).",
} as const;

/** One gateway's own page, opened with Manage on the Platform billing page: plans and deliveries on the left, keys and webhook on the right. */
export function BillingGateway() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = useHasRole("platform_owner");
  const { gateway: raw } = useParams({ strict: false }) as { gateway?: string };
  const gateway = raw === "razorpay" || raw === "cashfree" || raw === "paypal" ? raw : null;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["platform", "integrations", "billing"],
    queryFn: () => client.integrations.billingSettings(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform", "integrations", "billing"] });
  const back = () => navigate({ to: "/integrations/billing" });

  if (!gateway) {
    return (
      <PageContainer>
        <Button variant="ghost" size="sm" className="mb-4 gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => void back()}>
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Platform billing</span>
        </Button>
        <PageHeader title="Unknown gateway" description="Choose Razorpay, Cashfree or PayPal from Platform billing." />
      </PageContainer>
    );
  }

  const name = GATEWAY_NAME[gateway];
  const active = data ? (gateway === "paypal" ? data.paypalEnabled : data.provider === gateway) : false;
  const url = data ? (gateway === "paypal" ? data.paypalWebhookUrl : gateway === "cashfree" ? data.cashfreeWebhookUrl : data.webhookUrl) : "";

  return (
    <PageContainer>
      <div className="mb-4">
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => void back()}>
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Platform billing</span>
        </Button>
      </div>

      <PageHeader
        title={name}
        description={BLURB[gateway]}
        meta={data ? <Badge variant={active ? "default" : "secondary"}>{active ? "Active" : "Not active"}</Badge> : undefined}
      />

      {isLoading ? <MetricCardsSkeleton count={3} /> : null}
      {isError ? (
        <div role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-foreground">Could not load billing settings</p>
          <p className="text-foreground-2">{messageOf(error)}</p>
          <Button size="sm" className="mt-2" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      {data ? (
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-6">
            {gateway === "razorpay" ? <PlansCard canEdit={canEdit} /> : gateway === "cashfree" ? <CashfreePlansCard /> : <PayPalPlansCard />}
            <WebhookDeliveriesCard gateway={gateway} />
          </div>
          <div className="space-y-6">
            {gateway === "razorpay" ? (
              <>
                <KeysCard mode="test" view={data.test} active={active && data.mode === "test"} canEdit={canEdit} onSaved={refresh} />
                <KeysCard mode="live" view={data.live} active={active && data.mode === "live"} canEdit={canEdit} onSaved={refresh} />
              </>
            ) : gateway === "cashfree" ? (
              <>
                <CashfreeKeysCard mode="test" view={data.cashfree.test} active={active && data.mode === "test"} canEdit={canEdit} onSaved={refresh} />
                <CashfreeKeysCard mode="live" view={data.cashfree.live} active={active && data.mode === "live"} canEdit={canEdit} onSaved={refresh} />
              </>
            ) : (
              <>
                <PayPalKeysCard mode="test" view={data.paypal.test} active={active && data.mode === "test"} canEdit={canEdit} onSaved={refresh} />
                <PayPalKeysCard mode="live" view={data.paypal.live} active={active && data.mode === "live"} canEdit={canEdit} onSaved={refresh} />
              </>
            )}
            <WebhookUrlCard gateway={gateway} url={url} />
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
