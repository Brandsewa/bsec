"use client";

import { useEffect, useRef, useState } from "react";
import { mountStripeEmbedded, type StripeEmbeddedParams } from "@/lib/stripe-client.ts";

/**
 * Stripe's card form inside our own checkout page (a panel over the page, so the shopper's details stay on screen behind it).
 * When the shopper pays, Stripe sends the window to our return route, which settles the order from Stripe's own record.
 * "Cancel" releases the held order through the same abandon route Razorpay uses.
 */
export function StripeEmbeddedOverlay({ params, onCancel }: { params: StripeEmbeddedParams; onCancel: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const target = mountRef.current;
    if (!target) return;
    let destroy: (() => void) | null = null;
    let cancelled = false;
    mountStripeEmbedded(params, target)
      .then((d) => {
        if (cancelled) d();
        else {
          destroy = d;
          setReady(true);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the payment form."));
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [params]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Pay securely" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-background shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">Pay securely</h2>
          <button type="button" onClick={onCancel} className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {!ready && !error ? <p className="py-6 text-center text-sm text-muted-foreground">Loading the payment form…</p> : null}
          {error ? (
            <p role="alert" className="py-6 text-center text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div ref={mountRef} />
        </div>
      </div>
    </div>
  );
}
