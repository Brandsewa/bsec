"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, FieldLabel, Input, Checkbox, Alert, AlertDescription } from "@bs/ui";

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

      <Field className="space-y-1.5">
        <FieldLabel htmlFor="profile-phone">Mobile number</FieldLabel>
        <Input
          id="profile-phone"
          value={props.phone ?? ""}
          placeholder="No phone number linked"
          readOnly
          disabled
          className="h-10 sm:h-9 opacity-70"
        />
      </Field>

      <Field className="space-y-1.5">
        <FieldLabel htmlFor="profile-name">Name</FieldLabel>
        <Input
          id="profile-name"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className="h-10 sm:h-9"
        />
      </Field>

      <Field className="space-y-1.5">
        <FieldLabel htmlFor="profile-email">Email</FieldLabel>
        <Input
          id="profile-email"
          required
          type="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="h-10 sm:h-9"
        />
      </Field>

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
