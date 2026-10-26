"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@bs/ui";
import { payWithRazorpay } from "@/lib/razorpay-client.ts";

/** Shown on an order whose online payment was not completed; reopens Razorpay for the same order. */
export function PayNowButton({ orderToken }: { orderToken: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/storefront/checkout/razorpay/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not start the payment");
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
    </div>
  );
}
