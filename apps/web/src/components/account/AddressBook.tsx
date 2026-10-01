"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export interface SavedAddress {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  stateCode: string;
  pincode: string;
  type: string;
  isDefault: boolean;
}

interface FormState {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  stateCode: string;
  pincode: string;
  type: string;
  isDefault: boolean;
}

const blank = (phone: string): FormState => ({ name: "", phone, line1: "", line2: "", landmark: "", city: "", stateCode: "", pincode: "", type: "home", isDefault: false });
const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

/** The shopper's saved addresses: add, edit, make default, remove. */
export function AddressBook({ addresses, phone }: { addresses: SavedAddress[]; phone: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(blank(phone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(a?: SavedAddress) {
    setError(null);
    setEditing(a ? a.id : "new");
    setForm(
      a
        ? { name: a.name, phone: a.phone, line1: a.line1, line2: a.line2 ?? "", landmark: a.landmark ?? "", city: a.city, stateCode: a.stateCode, pincode: a.pincode, type: a.type, isDefault: a.isDefault }
        : blank(phone),
    );
  }

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = { ...form, line2: form.line2 || undefined, landmark: form.landmark || undefined };
      if (editing === "new") await call("/api/storefront/customer/addresses", "POST", body);
      else await call(`/api/storefront/customer/addresses/${editing}`, "PUT", body);
      setEditing(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the address");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    setBusy(true);
    try {
      await call(`/api/storefront/customer/addresses/${id}`, "DELETE");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the address");
    } finally {
      setBusy(false);
    }
  }

  const text = (key: keyof FormState, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-foreground">{label}</span>
      <input value={form[key] as string} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className={inputClass} {...extra} />
    </label>
  );

  return (
    <div className="space-y-4" data-testid="address-book">
      {addresses.length === 0 && editing === null ? <p className="text-sm text-muted-foreground">You have no saved addresses yet.</p> : null}
      <ul className="space-y-3">
        {addresses.map((a) => (
          <li key={a.id} className="rounded-xl border border-border p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-foreground">
                  {a.name} {a.isDefault ? <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Default</span> : null}
                </div>
                <div className="text-muted-foreground">
                  {[a.line1, a.line2, a.landmark].filter(Boolean).join(", ")}
                  <br />
                  {a.city}, {a.stateCode} {a.pincode}
                  <br />
                  {a.phone}
                </div>
              </div>
              <div className="flex shrink-0 gap-3">
                <button type="button" onClick={() => open(a)} className="font-medium text-primary hover:underline">
                  Edit
                </button>
                <button type="button" onClick={() => remove(a.id)} disabled={busy} className="font-medium text-red-600 hover:underline disabled:opacity-60">
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {editing === null ? (
        <button type="button" onClick={() => open()} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted">
          Add an address
        </button>
      ) : (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{editing === "new" ? "New address" : "Edit address"}</h3>
          {text("name", "Recipient name", { required: true, maxLength: 120 })}
          {text("phone", "Phone", { required: true, inputMode: "numeric", pattern: "[6-9][0-9]{9}", maxLength: 10 })}
          {text("line1", "Address", { required: true, maxLength: 200 })}
          {text("line2", "Apartment, suite (optional)", { maxLength: 200 })}
          {text("landmark", "Landmark (optional)", { maxLength: 200 })}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {text("city", "City", { required: true, maxLength: 80 })}
            {text("stateCode", "State", { required: true, maxLength: 80 })}
            {text("pincode", "Pincode", { required: true, inputMode: "numeric", pattern: "[1-9][0-9]{5}", maxLength: 6 })}
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">Type</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputClass}>
              <option value="home">Home</option>
              <option value="work">Work</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
            <span>Make this my default address</span>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {busy ? "Saving…" : "Save address"}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-4 py-2 text-sm text-muted-foreground">
              Cancel
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
