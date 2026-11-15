"use client";

import { useRef, useState } from "react";
import { Button } from "@bs/ui";
import type { StripePaymentApi, StripePaymentParams } from "@/lib/stripe-client.ts";
import { StripePaymentElement } from "./StripePaymentElement.tsx";

/**
 * "Pay now" on an order that is already placed: Stripe's fields in a panel over the order page. Paying sends the window to our
 * return route, which settles the order from Stripe's own record. Closing the panel keeps the order held.
 */
export function StripePayOverlay({ params, orderToken, onClose }: { params: StripePaymentParams; orderToken: string; onClose: () => void }) {
  const apiRef = useRef<StripePaymentApi | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    const api = apiRef.current;
    if (!api) return;
    setBusy(true);
    setError(null);
    const returnUrl = `${window.location.origin}/api/storefront/checkout/return?provider=stripe&ot=${encodeURIComponent(orderToken)}`;
    const failure = await api.pay(null, returnUrl);
    // On success Stripe has already sent the window away; this only runs when the payment was refused.
    if (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Pay securely" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-background shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">Pay securely</h2>
          <button type="button" onClick={onClose} className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4">
          <StripePaymentElement config={params} mode={{ kind: "secret", clientSecret: params.clientSecret }} apiRef={apiRef} />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button variant="primary" className="w-full" onClick={() => void pay()} disabled={busy}>
            {busy ? "Processing…" : "Pay now"}
          </Button>
        </div>
      </div>
    </div>
  );
}
