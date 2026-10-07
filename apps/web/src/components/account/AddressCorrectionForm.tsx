"use client";

import React, { useState } from "react";
import { Button, Field, FieldLabel, Input, Alert, AlertDescription } from "@bs/ui";

export interface AddressFields {
  fullName: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  city: string;
  state: string;
  pincode: string;
}

/** Lets a shopper correct the delivery address of an order that has not shipped yet. */
export function AddressCorrectionForm({ token, initial }: { token: string; initial: AddressFields }) {
  const [form, setForm] = useState<AddressFields>({ ...initial, addressLine2: initial.addressLine2 ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof AddressFields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setForm({ ...form, [key]: e.target.value });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/storefront/address/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not update the address");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the address");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="address-form">
      <Field className="space-y-1.5">
        <FieldLabel htmlFor="corr-name">Full name</FieldLabel>
        <Input
          id="corr-name"
          required
          maxLength={120}
          value={form.fullName}
          onChange={set("fullName")}
          autoComplete="name"
          className="h-10 sm:h-9"
        />
      </Field>

      <Field className="space-y-1.5">
        <FieldLabel htmlFor="corr-line1">Address</FieldLabel>
        <Input
          id="corr-line1"
          required
          maxLength={200}
          value={form.addressLine1}
          onChange={set("addressLine1")}
          autoComplete="address-line1"
          className="h-10 sm:h-9"
        />
      </Field>

      <Field className="space-y-1.5">
        <FieldLabel htmlFor="corr-line2">Apartment, landmark (optional)</FieldLabel>
        <Input
          id="corr-line2"
          maxLength={200}
          value={form.addressLine2 ?? ""}
          onChange={set("addressLine2")}
          autoComplete="address-line2"
          className="h-10 sm:h-9"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field className="space-y-1.5">
          <FieldLabel htmlFor="corr-city">City</FieldLabel>
          <Input
            id="corr-city"
            required
            maxLength={80}
            value={form.city}
            onChange={set("city")}
            autoComplete="address-level2"
            className="h-10 sm:h-9"
          />
        </Field>

        <Field className="space-y-1.5">
          <FieldLabel htmlFor="corr-state">State</FieldLabel>
          <Input
            id="corr-state"
            required
            maxLength={80}
            value={form.state}
            onChange={set("state")}
            autoComplete="address-level1"
            className="h-10 sm:h-9"
          />
        </Field>

        <Field className="space-y-1.5">
          <FieldLabel htmlFor="corr-pincode">Pincode</FieldLabel>
          <Input
            id="corr-pincode"
            required
            inputMode="numeric"
            pattern="[1-9][0-9]{5}"
            maxLength={6}
            value={form.pincode}
            onChange={set("pincode")}
            autoComplete="postal-code"
            className="h-10 sm:h-9"
          />
        </Field>
      </div>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      {saved ? (
        <Alert variant="default" className="border-[var(--brand)] bg-[var(--brand-soft)]" role="status">
          <AlertDescription className="text-xs text-[var(--foreground)]">
            Thanks, your delivery address is updated.
          </AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="md" disabled={busy} loading={busy}>
        {busy ? "Saving…" : "Update address"}
      </Button>
    </form>
  );
}
