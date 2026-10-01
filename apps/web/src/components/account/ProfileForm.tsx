"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export interface ProfileFormProps {
  phone: string;
  name: string;
  /** Empty while the account still has the placeholder email made at sign-in. */
  email: string;
  acceptsMarketing: boolean;
}

/** Name, email and marketing choice. The phone number is the login and is shown read-only. */
export function ProfileForm(props: ProfileFormProps) {
  const router = useRouter();
  const [name, setName] = useState(props.name);
  const [email, setEmail] = useState(props.email);
  const [acceptsMarketing, setAcceptsMarketing] = useState(props.acceptsMarketing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const res = await fetch("/api/storefront/customer/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, acceptsMarketing }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save your details");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your details");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="profile-form">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-foreground">Mobile number</span>
        <input value={props.phone} readOnly disabled className={`${inputClass} opacity-70`} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-foreground">Name</span>
        <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="name" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-foreground">Email</span>
        <input required type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} autoComplete="email" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={acceptsMarketing} onChange={(e) => setAcceptsMarketing(e.target.checked)} />
        <span>Send me offers and news by email</span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm font-medium text-primary">
          Saved.
        </p>
      ) : null}
      <button type="submit" disabled={busy} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {busy ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
