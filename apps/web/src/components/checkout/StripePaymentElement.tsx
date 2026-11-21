"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { mountStripePayment, type StripeConfig, type StripeMount, type StripePaymentApi } from "@/lib/stripe-client.ts";

/**
 * Stripe's card (and wallet) fields, inside our own page. The fields are Stripe's iframe, so card details never touch our code.
 * The parent drives it through `apiRef` (validate, pay). Deferred mode shows the fields before the order exists; the amount
 * follows the order total.
 */
export function StripePaymentElement({
  config,
  mode,
  amount,
  apiRef,
}: {
  config: StripeConfig;
  mode: StripeMount;
  /** The current order total in minor units, for deferred mode. */
  amount?: number | undefined;
  apiRef: MutableRefObject<StripePaymentApi | null>;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // The mount options that matter are the currency and the secret; the amount is updated separately once mounted.
  const currency = mode.kind === "deferred" ? mode.currency : "";
  const secret = mode.kind === "secret" ? mode.clientSecret : "";
  const startAmount = useRef(amount ?? 0);
  useEffect(() => {
    startAmount.current = amount ?? 0;
  }, [amount]);

  useEffect(() => {
    const target = mountRef.current;
    if (!target) return;
    let cancelled = false;
    let api: StripePaymentApi | null = null;
    const startMode: StripeMount = secret ? { kind: "secret", clientSecret: secret } : { kind: "deferred", amount: startAmount.current, currency };
    mountStripePayment(config, startMode, target)
      .then((a) => {
        if (cancelled) a.destroy();
        else {
          api = a;
          apiRef.current = a;
          setReady(true);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the payment form."));
    return () => {
      cancelled = true;
      api?.destroy();
      if (apiRef.current === api) apiRef.current = null;
    };
  }, [config, currency, secret, apiRef]);

  useEffect(() => {
    if (ready && amount !== undefined) apiRef.current?.setAmount(amount);
  }, [ready, amount, apiRef]);

  return (
    <div>
      {!ready && !error ? <p className="py-3 text-sm text-muted-foreground">Loading the payment form…</p> : null}
      {error ? (
        <p role="alert" className="py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div ref={mountRef} />
    </div>
  );
}
