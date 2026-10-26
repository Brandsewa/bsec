import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Input, PageContainer, PageSkeleton, SimpleSelect, toast } from "@bs/ui";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { fetchMe } from "../../lib/auth.ts";
import { openCashfreeCheckout } from "../../lib/cashfree-checkout.ts";

/**
 * Shown instead of the dashboard to a store that signed up while the free trial was off and has not paid yet. The owner picks the
 * plan, pays, and the store opens as soon as the payment is confirmed (the gateway's signed webhook, never this page).
 */
export function ActivateStore({ storeName, onSignOut }: { storeName: string; onSignOut: () => void }) {
  const billingQuery = useQuery(orpc.admin.planAndBilling.get.queryOptions());
  const plansQuery = useQuery(orpc.admin.planAndBilling.availablePlans.queryOptions());
  const subscribe = useMutation(orpc.admin.planAndBilling.subscribe.mutationOptions());
  const [planCode, setPlanCode] = useState("");
  const [billed, setBilled] = useState<"monthly" | "yearly">("monthly");
  const [phone, setPhone] = useState("");

  // The store opens by itself once the payment is confirmed: watch for it.
  const meQuery = useQuery({ queryKey: ["me", "activation"], queryFn: fetchMe, refetchInterval: 4000 });
  const stillRequired = meQuery.data?.stores.some((s) => s.paymentRequired) ?? true;
  useEffect(() => {
    if (meQuery.data && !stillRequired) window.location.assign("/");
  }, [meQuery.data, stillRequired]);

  const plans = plansQuery.data ?? [];
  const billing = billingQuery.data?.billing;
  const currentCode = billingQuery.data?.plan?.code ?? "";
  // The plan chosen at signup is preselected until the owner picks another.
  const chosenPlan = planCode || (plans.find((p) => p.code === currentCode)?.code ?? plans[0]?.code ?? "");

  if (billingQuery.isLoading || plansQuery.isLoading) return <PageSkeleton />;

  const isCashfree = billing?.provider === "cashfree";
  const needsPhone = isCashfree && !billing?.phoneOnFile;
  const confirming = Boolean(billing?.authorized);
  const chosen = plans.find((p) => p.code === chosenPlan);
  const freeEnds = billing?.freePeriodEndsAt ? new Date(billing.freePeriodEndsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;
  const coupon = billing?.firstPaymentCoupon;
  const price = (p: (typeof plans)[number]) => (billed === "yearly" ? p.priceYearlyPaise : p.priceMonthlyPaise);
  const discounted = !freeEnds && chosen && coupon && (!coupon.planCode || coupon.planCode === chosen.code) ? Math.round((price(chosen) * (100 - coupon.percentOff)) / 100) : 0;

  return (
    <PageContainer size="small">
      <div className="mx-auto max-w-lg space-y-5 py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Activate {storeName}</h1>
          <p className="text-sm text-muted-foreground">Your account is ready. Choose your plan and pay to open your store.</p>
        </div>

        {confirming ? (
          <div role="status" className="space-y-2 rounded-lg border border-border bg-card p-5 text-sm">
            <p className="font-medium text-foreground">Confirming your payment…</p>
            <p className="text-muted-foreground">
              This page opens your store automatically as soon as the payment is confirmed. It usually takes under a minute. If it takes more than a few minutes, contact support.
            </p>
          </div>
        ) : !billing?.available ? (
          <div role="alert" className="space-y-2 rounded-lg border border-border bg-card p-5 text-sm">
            <p className="font-medium text-foreground">Online payment is not available right now.</p>
            <p className="text-muted-foreground">Contact support and we will activate your store.</p>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            {billing.testMode ? (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                Payments are in test mode: use {isCashfree ? "Cashfree" : "Razorpay"} test payment details. No real money moves.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Plan</p>
                <SimpleSelect
                  value={chosenPlan}
                  onChange={setPlanCode}
                  placeholder="Choose a plan"
                  options={plans.map((p) => ({ value: p.code, label: `${p.name} (₹${(price(p) / 100).toLocaleString("en-IN")}/${billed === "yearly" ? "yr" : "mo"})` }))}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Billed</p>
                <SimpleSelect
                  value={billed}
                  onChange={(v) => setBilled(v === "yearly" ? "yearly" : "monthly")}
                  options={[
                    { value: "monthly", label: "Monthly" },
                    { value: "yearly", label: "Yearly" },
                  ]}
                />
              </div>
            </div>
            {needsPhone ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Mobile number</p>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" aria-label="Mobile number for the payment mandate" />
              </div>
            ) : null}
            {freeEnds ? (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-foreground">
                To open your store we set up automatic payment through {isCashfree ? "UPI AutoPay or card" : "card or UPI"}; about ₹1 is taken to verify it and is refunded. Your coupon covers the time until {freeEnds}, so nothing else is charged now. After that you are charged {chosen ? `₹${(price(chosen) / 100).toLocaleString("en-IN")}` : "the plan price"} every {billed === "yearly" ? "year" : "month"} automatically, and you can stop it any time before then.
              </p>
            ) : chosen && discounted ? (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-foreground">
                Your coupon takes {billing?.firstPaymentCoupon?.percentOff}% off your first payment: you pay ₹{(discounted / 100).toLocaleString("en-IN")} instead of ₹{(price(chosen) / 100).toLocaleString("en-IN")} to open your store. After that it renews automatically at ₹{(price(chosen) / 100).toLocaleString("en-IN")} every {billed === "yearly" ? "year" : "month"}, and you can stop it any time.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                You pay the first {billed === "yearly" ? "year" : "month"} now through {isCashfree ? "UPI AutoPay or card" : "card or UPI"}; after that it renews automatically and you can stop it any time.
              </p>
            )}
            <Button
              className="w-full"
              disabled={!chosenPlan || subscribe.isPending || (needsPhone && phone.replace(/\D/g, "").length < 10)}
              onClick={() =>
                subscribe.mutate(
                  {
                    planCode: chosenPlan,
                    interval: billed,
                    ...(needsPhone ? { phone: phone.trim() } : {}),
                    ...(isCashfree ? { returnUrl: `${window.location.origin}/` } : {}),
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
                )
              }
            >
              {subscribe.isPending ? "Opening payment page..." : freeEnds ? "Verify payment method and open my store" : "Pay and open my store"}
            </Button>
          </div>
        )}

        <button type="button" onClick={onSignOut} className="text-xs text-muted-foreground underline underline-offset-2">
          Sign out
        </button>
      </div>
    </PageContainer>
  );
}
