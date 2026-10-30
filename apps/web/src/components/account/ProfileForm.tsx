"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Alert, AlertDescription } from "@bs/ui";
import { FloatingField } from "./FloatingField.tsx";

export interface ProfileFormProps {
  phone: string | null;
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
        body: JSON.stringify({ name: name.trim(), email: email.trim(), acceptsMarketing }),
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
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      {saved ? (
        <Alert variant="default" className="border-[var(--brand)] bg-[var(--brand-soft)]" role="status">
          <AlertDescription className="text-xs text-[var(--foreground)]">
            Saved.
          </AlertDescription>
        </Alert>
      ) : null}

      <FloatingField id="profile-name" label="Name" maxLength={120} autoComplete="name" value={name} onChange={setName} />
      <FloatingField id="profile-email" label="Email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={setEmail} />
      {/* the phone number is the login, so it is shown but cannot be edited here */}
      <FloatingField id="profile-phone" label="Mobile number" disabled value={props.phone ?? ""} onChange={() => undefined} />

      <div className="flex items-center gap-2.5 pt-1">
        <Checkbox
          id="profile-marketing"
          checked={acceptsMarketing}
          onCheckedChange={(checked) => setAcceptsMarketing(checked === true)}
        />
        <label htmlFor="profile-marketing" className="text-xs text-[var(--muted-foreground)] cursor-pointer select-none">
          Send me offers and news by email
        </label>
      </div>

      <Button type="submit" size="md" disabled={busy} loading={busy}>
        {busy ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
