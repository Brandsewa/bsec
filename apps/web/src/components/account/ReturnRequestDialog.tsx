"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "@bs/ui";
import { ReturnRequestForm } from "@/components/orders/ReturnRequestForm.tsx";

type FormProps = React.ComponentProps<typeof ReturnRequestForm>;
type FormData = {
  token: string;
  view: {
    items: FormProps["items"];
    reasons: NonNullable<FormProps["reasons"]>;
    allowExchanges: boolean;
    policyText: string;
    instructions: string;
  };
};

const BRAND_VARS = ["--brand", "--brand-deep", "--brand-ink", "--brand-soft", "--ring", "--primary", "--primary-foreground"];

async function fetchForm(orderId: string): Promise<FormData> {
  const r = await fetch(`/api/storefront/customer/returns/form/${orderId}`);
  const body = (await r.json().catch(() => ({}))) as FormData & { error?: string };
  if (!r.ok) throw new Error(body.error ?? "Could not open the return form");
  return body;
}

/** A "Request a return" button that opens the return form in a pop-up for one order. `autoOpen` opens it on arrival (from an order page). */
export function ReturnRequestDialog({ orderId, orderNumber, autoOpen = false, label = "Request a return" }: { orderId: string; orderNumber: string; autoOpen?: boolean; label?: string }) {
  const [open, setOpen] = useState(autoOpen);
  const [data, setData] = useState<FormData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const holder = useRef<HTMLSpanElement>(null);
  // the pop-up is drawn outside the page wrapper that carries the store's brand colours, so they are copied across
  const [brand, setBrand] = useState<React.CSSProperties>({});

  function load() {
    fetchForm(orderId).then(setData, (e: unknown) => setError(e instanceof Error ? e.message : "Could not open the return form"));
  }

  function show() {
    if (holder.current) {
      const cs = getComputedStyle(holder.current);
      const vars: Record<string, string> = {};
      for (const n of BRAND_VARS) vars[n] = cs.getPropertyValue(n);
      setBrand(vars as React.CSSProperties);
    }
    setData(null);
    setError(null);
    setOpen(true);
    load();
  }

  // arriving from an order page with ?request=: open straight away
  useEffect(() => {
    if (autoOpen) fetchForm(orderId).then(setData, (e: unknown) => setError(e instanceof Error ? e.message : "Could not open the return form"));
  }, [autoOpen, orderId]);

  return (
    <>
      <span ref={holder} className="inline-flex">
        <Button type="button" variant="secondary" size="sm" onClick={show}>
          {label}
        </Button>
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent style={brand} className="bs-account max-h-[90vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--muted)] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Return items from {orderNumber}</DialogTitle>
          </DialogHeader>
          {error ? <p role="alert" className="text-sm text-[var(--destructive)]">{error}</p> : null}
          {!data && !error ? <p className="text-sm text-[var(--muted-foreground)]">Loading…</p> : null}
          {data ? (
            <ReturnRequestForm
              token={data.token}
              items={data.view.items}
              reasons={data.view.reasons}
              allowExchanges={data.view.allowExchanges}
              policyText={data.view.policyText}
              instructions={data.view.instructions}
              startOpen
              onDone={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
