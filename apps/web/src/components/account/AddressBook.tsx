"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Field,
  FieldLabel,
  Input,
  SimpleSelect,
  Checkbox,
  Badge,
  Alert,
  AlertDescription,
} from "@bs/ui";

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

const ADDRESS_TYPES = [
  { value: "home", label: "Home" },
  { value: "work", label: "Work" },
  { value: "other", label: "Other" },
];

const blank = (phone: string | null): FormState => ({
  name: "",
  phone: phone ?? "",
  line1: "",
  line2: "",
  landmark: "",
  city: "",
  stateCode: "",
  pincode: "",
  type: "home",
  isDefault: false,
});

/** The shopper's saved addresses: add, edit, make default, remove. */
export function AddressBook({ addresses, phone }: { addresses: SavedAddress[]; phone: string | null }) {
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
        ? {
            name: a.name,
            phone: a.phone,
            line1: a.line1,
            line2: a.line2 ?? "",
            landmark: a.landmark ?? "",
            city: a.city,
            stateCode: a.stateCode,
            pincode: a.pincode,
            type: a.type,
            isDefault: a.isDefault,
          }
        : blank(phone),
    );
  }

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
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

  return (
    <div className="space-y-5" data-testid="address-book">
      {addresses.length === 0 && editing === null ? (
        <p className="text-sm text-[var(--muted-foreground)]">You have no saved addresses yet.</p>
      ) : null}

      <ul className="space-y-3">
        {addresses.map((a) => (
          <li key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-[var(--foreground)] flex items-center gap-2">
                  <span>{a.name}</span>
                  {a.isDefault ? (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      Default
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-[var(--muted-foreground)] leading-relaxed">
                  {[a.line1, a.line2, a.landmark].filter(Boolean).join(", ")}
                  <br />
                  {a.city}, {a.stateCode} {a.pincode}
                  <br />
                  {a.phone}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => open(a)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(a.id)}
                  disabled={busy}
                  className="text-[var(--destructive)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-soft)]"
                >
                  Remove
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {editing === null ? (
        <Button type="button" variant="secondary" size="md" onClick={() => open()}>
          Add an address
        </Button>
      ) : (
        <form onSubmit={save} className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            {editing === "new" ? "New address" : "Edit address"}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field className="space-y-1.5">
              <FieldLabel htmlFor="addr-name">Recipient name</FieldLabel>
              <Input
                id="addr-name"
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-10 sm:h-9"
              />
            </Field>

            <Field className="space-y-1.5">
              <FieldLabel htmlFor="addr-phone">Phone</FieldLabel>
              <Input
                id="addr-phone"
                required
                inputMode="numeric"
                pattern="[6-9][0-9]{9}"
                maxLength={10}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="h-10 sm:h-9"
              />
            </Field>
          </div>

          <Field className="space-y-1.5">
            <FieldLabel htmlFor="addr-line1">Address line 1</FieldLabel>
            <Input
              id="addr-line1"
              required
              maxLength={200}
              value={form.line1}
              onChange={(e) => setForm({ ...form, line1: e.target.value })}
              className="h-10 sm:h-9"
            />
          </Field>

          <Field className="space-y-1.5">
            <FieldLabel htmlFor="addr-line2">Apartment, suite (optional)</FieldLabel>
            <Input
              id="addr-line2"
              maxLength={200}
              value={form.line2}
              onChange={(e) => setForm({ ...form, line2: e.target.value })}
              className="h-10 sm:h-9"
            />
          </Field>

          <Field className="space-y-1.5">
            <FieldLabel htmlFor="addr-landmark">Landmark (optional)</FieldLabel>
            <Input
              id="addr-landmark"
              maxLength={200}
              value={form.landmark}
              onChange={(e) => setForm({ ...form, landmark: e.target.value })}
              className="h-10 sm:h-9"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field className="space-y-1.5">
              <FieldLabel htmlFor="addr-city">City</FieldLabel>
              <Input
                id="addr-city"
                required
                maxLength={80}
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="h-10 sm:h-9"
              />
            </Field>

            <Field className="space-y-1.5">
              <FieldLabel htmlFor="addr-state">State</FieldLabel>
              <Input
                id="addr-state"
                required
                maxLength={80}
                value={form.stateCode}
                onChange={(e) => setForm({ ...form, stateCode: e.target.value })}
                className="h-10 sm:h-9"
              />
            </Field>

            <Field className="space-y-1.5">
              <FieldLabel htmlFor="addr-pincode">Pincode</FieldLabel>
              <Input
                id="addr-pincode"
                required
                inputMode="numeric"
                pattern="[1-9][0-9]{5}"
                maxLength={6}
                value={form.pincode}
                onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                className="h-10 sm:h-9"
              />
            </Field>
          </div>

          <Field className="space-y-1.5">
            <FieldLabel htmlFor="addr-type">Address Type</FieldLabel>
            <SimpleSelect
              id="addr-type"
              value={form.type}
              onChange={(val: string) => setForm({ ...form, type: val as "home" | "work" | "other" })}
              options={ADDRESS_TYPES}
            />
          </Field>

          <div className="flex items-center gap-2.5 pt-1">
            <Checkbox
              id="addr-default"
              checked={form.isDefault}
              onCheckedChange={(checked) => setForm({ ...form, isDefault: checked === true })}
            />
            <label htmlFor="addr-default" className="text-xs text-[var(--muted-foreground)] cursor-pointer select-none">
              Make this my default address
            </label>
          </div>

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center gap-2.5 pt-2">
            <Button type="submit" size="md" disabled={busy} loading={busy}>
              {busy ? "Saving…" : "Save address"}
            </Button>
            <Button type="button" variant="ghost" size="md" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
