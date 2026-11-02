import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Badge, Button, Input, PageContainer, PageSkeleton, cn, toast } from "@bs/ui";
import { formatMoney } from "@bs/contracts/money";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { fetchMe } from "../../lib/auth.ts";
import { openCashfreeCheckout } from "../../lib/cashfree-checkout.ts";

/**
 * Shown instead of the dashboard to a store that signed up while the free trial was off and has not paid yet. The owner picks the
 * plan, pays, and the store opens as soon as the payment is confirmed (the gateway's signed webhook, never this page).
 */
export function ActivateStore({ storeName, onSignOut }: { storeName: string; onSignOut: () => void }) {
  // The page watches the payment: the gateway confirms it by webhook, a few seconds after the payer comes back.
  const billingQuery = useQuery({ ...orpc.admin.planAndBilling.get.queryOptions(), refetchInterval: 4000 });
  const plansQuery = useQuery(orpc.admin.planAndBilling.availablePlans.queryOptions());
  const subscribe = useMutation(orpc.admin.planAndBilling.subscribe.mutationOptions());
  const [planCode, setPlanCode] = useState("");
  const [billed, setBilled] = useState<"monthly" | "yearly">("monthly");
  const [phone, setPhone] = useState("");
  // PayPal sends the payer back with ?token=<order>; PayerID is present only when they approved (it is absent when they cancelled).
  const [paypalReturn] = useState<"approved" | "cancelled" | null>(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.get("token")) return null;
    return q.get("PayerID") ? "approved" : "cancelled";
  });
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!paypalReturn) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (paypalReturn === "cancelled") toast.info("Payment cancelled. Nothing was charged.");
  }, [paypalReturn]);

  // The store opens by itself once the payment is confirmed: watch for it.
  const meQuery = useQuery({ queryKey: ["me", "activation"], queryFn: fetchMe, refetchInterval: 4000 });
  const stillRequired = meQuery.data?.stores.some((s) => s.paymentRequired) ?? true;
  useEffect(() => {
    if (meQuery.data && !stillRequired) window.location.assign("/");
  }, [meQuery.data, stillRequired]);

  const plans = plansQuery.data ?? [];
  const billing = billingQuery.data?.billing;
  const currentCode = billingQuery.data?.plan?.code ?? "";
  // The plan chosen at signup is highlighted until the owner pays for another.
  const chosenPlan = planCode || (plans.find((p) => p.code === currentCode)?.code ?? plans[0]?.code ?? "");

  if (billingQuery.isLoading || plansQuery.isLoading) return <PageSkeleton />;

  const isCashfree = billing?.provider === "cashfree";
  // A store outside India is billed in USD through PayPal (the server decides; this page only follows it).
  const isPayPal = billing?.provider === "paypal";
  const currency = billing?.currency ?? "INR";
  const providerName = isPayPal ? "PayPal" : isCashfree ? "Cashfree" : "Razorpay";
  const payMethod = isPayPal ? "PayPal" : isCashfree ? "UPI AutoPay or card" : "card or UPI";
  const needsPhone = isCashfree && !billing?.phoneOnFile;
  // The payment failed when PayPal declined it after the payer came back: the subscription turns past due.
  const failed = paypalReturn === "approved" && !retrying && billingQuery.data?.plan?.status === "past_due";
  const confirming = !failed && (Boolean(billing?.authorized) || (paypalReturn === "approved" && !retrying));
  const freeEnds = billing?.freePeriodEndsAt ? new Date(billing.freePeriodEndsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;
  const coupon = billing?.firstPaymentCoupon;
  // Same fallback as the server (changeTenantPlan): a plan with no USD price is charged at its rupee price / 80.
  const price = (p: (typeof plans)[number]) => {
    if (!isPayPal) return billed === "yearly" ? p.priceYearlyPaise : p.priceMonthlyPaise;
    return billed === "yearly" ? (p.priceYearlyUsdCents ?? Math.round(p.priceYearlyPaise / 80)) : (p.priceMonthlyUsdCents ?? Math.round(p.priceMonthlyPaise / 80));
  };
  const money = (minor: number) => formatMoney(minor, currency);
  const perUnit = billed === "yearly" ? "year" : "month";
  // What the yearly price saves against twelve months, taken from the first plan that has both prices.
  const yearlySavePercent = (() => {
    const p = plans.find((x) => x.priceMonthlyPaise > 0 && x.priceYearlyPaise > 0);
    if (!p) return 0;
    const save = Math.round((1 - p.priceYearlyPaise / (p.priceMonthlyPaise * 12)) * 100);
    return save > 0 ? save : 0;
  })();
  const phoneMissing = needsPhone && phone.replace(/\D/g, "").length < 10;
  const buttonLabel = freeEnds && !isPayPal ? "Verify payment method and open my store" : "Pay and open my store";

  const pay = (code: string) => {
    setPlanCode(code);
    setRetrying(true);
    subscribe.mutate(
      {
        planCode: code,
        interval: billed,
        ...(needsPhone ? { phone: phone.trim() } : {}),
        ...(isCashfree || isPayPal ? { returnUrl: `${window.location.origin}/` } : {}),
      },
      {
        onSuccess: (res) => {
          if (res.checkoutSession) {
            void openCashfreeCheckout(res.checkoutSession).catch((e: unknown) => {
              console.error("Cashfree checkout failed", e);
              toast.error(e instanceof Error && e.message ? e.message : errorMessage(e));
            });
          } else if (res.checkoutUrl) window.location.assign(res.checkoutUrl);
          else toast.error("The payment page did not open. Try again.");
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <PageContainer>
      <div className="mx-auto max-w-5xl space-y-6 py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Activate {storeName}</h1>
          <p className="text-sm text-muted-foreground">Your account is ready. Choose your plan and pay to open your store.</p>
        </div>

        {failed ? (
          <div role="alert" className="max-w-lg space-y-3 rounded-lg border border-border bg-card p-5 text-sm">
            <p className="font-medium text-foreground">Your payment did not go through.</p>
            <p className="text-muted-foreground">PayPal declined it, so nothing was charged. Try again, or use another PayPal account or card.</p>
            <Button size="sm" onClick={() => setRetrying(true)}>
              Choose a plan again
            </Button>
          </div>
        ) : confirming ? (
          <div role="status" className="max-w-lg space-y-2 rounded-lg border border-border bg-card p-5 text-sm">
            <p className="font-medium text-foreground">Confirming your payment…</p>
            <p className="text-muted-foreground">
              This page opens your store automatically as soon as the payment is confirmed. It usually takes under a minute. If it takes more than a few minutes, contact support.
            </p>
          </div>
        ) : !billing?.available ? (
          <div role="alert" className="max-w-lg space-y-2 rounded-lg border border-border bg-card p-5 text-sm">
            <p className="font-medium text-foreground">Online payment is not available right now.</p>
            <p className="text-muted-foreground">Contact support and we will activate your store.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {billing.testMode ? (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                Payments are in test mode: use {providerName} {isPayPal ? "sandbox" : "test"} payment details. No real money moves.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <div role="tablist" aria-label="Billing period" className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
                {(["monthly", "yearly"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    role="tab"
                    aria-selected={billed === b}
                    onClick={() => setBilled(b)}
                    className={cn(
                      "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                      billed === b ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {b === "monthly" ? "Monthly" : "Yearly"}
                  </button>
                ))}
              </div>
              {yearlySavePercent > 0 ? <Badge variant="secondary">Save {yearlySavePercent}% yearly</Badge> : null}
            </div>

            {needsPhone ? (
              <div className="max-w-xs space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Mobile number</p>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" aria-label="Mobile number for the payment mandate" />
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {plans.map((p) => {
                const selected = p.code === chosenPlan;
                const list = price(p);
                // A percent-off coupon discounts the first payment only; PayPal charges the list price.
                const off = !isPayPal && !freeEnds && coupon && (!coupon.planCode || coupon.planCode === p.code) ? Math.round((list * (100 - coupon.percentOff)) / 100) : 0;
                const busy = subscribe.isPending && selected;
                return (
                  <div key={p.code} className={cn("flex flex-col rounded-xl border bg-card p-5", selected ? "border-foreground ring-1 ring-foreground" : "border-border")}>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-base font-semibold text-foreground">{p.name}</h2>
                      {p.badge ? <Badge>{p.badge}</Badge> : p.code === currentCode ? <Badge variant="secondary">Your pick</Badge> : null}
                    </div>
                    {p.tagline ? <p className="mt-1 text-xs text-muted-foreground">{p.tagline}</p> : null}
                    <p className="mt-4 text-3xl font-semibold text-foreground">
                      {list > 0 ? money(off || list) : "Free"}
                      {list > 0 ? <span className="text-sm font-normal text-muted-foreground"> / {perUnit}</span> : null}
                    </p>
                    <p className="min-h-4 text-xs text-muted-foreground">{off ? `then ${money(list)} / ${perUnit}. ${coupon?.percentOff}% off your first payment.` : ""}</p>
                    <ul className="mt-4 flex-1 space-y-2 text-sm text-muted-foreground">
                      {(p.bullets ?? []).slice(0, 5).map((line) => (
                        <li key={line} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                    <Button className="mt-5 w-full" variant={selected ? "default" : "outline"} disabled={subscribe.isPending || phoneMissing} onClick={() => pay(p.code)}>
                      {busy ? "Opening payment page..." : buttonLabel}
                    </Button>
                  </div>
                );
              })}
            </div>

            {freeEnds && !isPayPal ? (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-foreground">
                To open your store we set up automatic payment through {payMethod}; about {money(100)} is taken to verify it and is refunded. Your coupon covers the time until {freeEnds}, so nothing else is charged now. After that you are charged the plan price every {perUnit} automatically, and you can stop it any time before then.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {isPayPal
                  ? `You pay for the first ${perUnit} now through PayPal.`
                  : `You pay the first ${perUnit} now through ${payMethod}; after that it renews automatically and you can stop it any time.`}
              </p>
            )}
          </div>
        )}

        <button type="button" onClick={onSignOut} className="text-xs text-muted-foreground underline underline-offset-2">
          Sign out
        </button>
      </div>
    </PageContainer>
  );
}
