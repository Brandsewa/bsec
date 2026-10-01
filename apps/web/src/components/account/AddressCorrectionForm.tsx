"use client";

import React, { useState } from "react";

export interface AddressFields {
  fullName: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  city: string;
  state: string;
  pincode: string;
}

const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

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
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-foreground">Full name</span>
        <input required maxLength={120} value={form.fullName} onChange={set("fullName")} className={inputClass} autoComplete="name" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-foreground">Address</span>
        <input required maxLength={200} value={form.addressLine1} onChange={set("addressLine1")} className={inputClass} autoComplete="address-line1" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-foreground">Apartment, landmark (optional)</span>
        <input maxLength={200} value={form.addressLine2 ?? ""} onChange={set("addressLine2")} className={inputClass} autoComplete="address-line2" />
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">City</span>
          <input required maxLength={80} value={form.city} onChange={set("city")} className={inputClass} autoComplete="address-level2" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">State</span>
          <input required maxLength={80} value={form.state} onChange={set("state")} className={inputClass} autoComplete="address-level1" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">Pincode</span>
          <input required inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} value={form.pincode} onChange={set("pincode")} className={inputClass} autoComplete="postal-code" />
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="rounded-lg bg-primary/10 px-4 py-3 text-sm font-medium text-primary">
          Thanks, your delivery address is updated.
        </p>
      ) : null}
      <button type="submit" disabled={busy} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {busy ? "Saving…" : "Update address"}
      </button>
    </form>
  );
}
