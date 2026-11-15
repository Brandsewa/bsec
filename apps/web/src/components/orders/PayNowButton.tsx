"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@bs/ui";
import { payWithRazorpay, type RazorpayParams } from "@/lib/razorpay-client.ts";
import type { StripeEmbeddedParams } from "@/lib/stripe-client.ts";
import { StripeEmbeddedOverlay } from "@/components/checkout/StripeEmbeddedOverlay.tsx";

type Started =
  | { kind: "razorpay"; razorpay: RazorpayParams }
  | { kind: "hosted"; checkoutUrl: string }
  | { kind: "stripe_embedded"; stripe: StripeEmbeddedParams };

/**
 * Shown on an order whose online payment was not completed. The server picks the gateway from the order's own payment, so the
 * button works the same for Razorpay (its window), Stripe (the form in this page) and PayPal (its page).
 */
export function PayNowButton({ orderToken }: { orderToken: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripe, setStripe] = useState<StripeEmbeddedParams | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/storefront/checkout/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderToken }),
      });
      const data = (await res.json().catch(() => ({}))) as Started & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not start the payment");
      if (data.kind === "hosted") {
        window.location.assign(data.checkoutUrl);
        return;
      }
      if (data.kind === "stripe_embedded") {
        setStripe(data.stripe);
        return;
      }
      const outcome = await payWithRazorpay(data.razorpay, orderToken);
      if (outcome.status === "paid") router.refresh();
      else if (outcome.status === "failed") setError(outcome.message);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start the payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <Button variant="primary" onClick={() => void pay()} disabled={busy}>
        {busy ? "Opening payment…" : "Pay now"}
      </Button>
      {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
      {/* Closing the form keeps the order: it stays held and this button opens a fresh form. */}
      {stripe ? <StripeEmbeddedOverlay params={stripe} onCancel={() => setStripe(null)} /> : null}
    </div>
  );
}
