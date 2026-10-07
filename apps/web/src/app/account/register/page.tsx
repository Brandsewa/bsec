"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AuthShell, Button, Field, FieldLabel, Input, Checkbox, Alert, AlertDescription } from "@bs/ui";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [acceptsMarketing, setAcceptsMarketing] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/storefront/customer/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim(),
          phone: phone.trim() || undefined,
          acceptsMarketing,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Registration failed. Please try again.");
      }

      setRegistered(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="register-form">
      <AuthShell
        variant="store"
        brand={{ name: "Store" }}
        title="Create account"
        description="Sign up to track orders, save multiple addresses, and checkout faster."
        footer={
          <span>
            Already have an account?{" "}
            <Link href="/account/login" className="font-semibold text-[var(--brand-ink)] hover:underline">
              Sign in
            </Link>
          </span>
        }
      >
        {registered ? (
          <div className="space-y-4">
            <Alert variant="default" className="border-[var(--brand)] bg-[var(--brand-soft)]">
              <AlertDescription className="text-xs text-[var(--foreground)]">
                An account setup link has been sent to <strong className="text-[var(--foreground)]">{email}</strong>. Please check your inbox and click the link to set your password and complete your registration.
              </AlertDescription>
            </Alert>
            <Button asChild size="md" className="w-full">
              <Link href="/account/login">Return to sign in</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4">
            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            ) : null}

            <Field className="space-y-1.5">
              <FieldLabel htmlFor="register-name">Full name (optional)</FieldLabel>
              <Input
                id="register-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="Your name"
                className="h-10 sm:h-9"
              />
            </Field>

            <Field className="space-y-1.5">
              <FieldLabel htmlFor="register-email">Email address</FieldLabel>
              <Input
                id="register-email"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                className="h-10 sm:h-9"
              />
            </Field>

            <Field className="space-y-1.5">
              <FieldLabel htmlFor="register-phone">Phone number (optional)</FieldLabel>
              <Input
                id="register-phone"
                inputMode="numeric"
                pattern="[6-9][0-9]{9}"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                autoComplete="tel-national"
                placeholder="10-digit number"
                className="h-10 sm:h-9"
              />
              <span className="block text-[11px] text-[var(--muted-foreground)]">Mandatory only at checkout for delivery.</span>
            </Field>

            <div className="flex items-start gap-2.5 pt-1">
              <Checkbox
                id="accepts-marketing"
                checked={acceptsMarketing}
                onCheckedChange={(checked) => setAcceptsMarketing(checked === true)}
                className="mt-0.5"
              />
              <label htmlFor="accepts-marketing" className="text-xs text-[var(--muted-foreground)] leading-snug cursor-pointer select-none">
                Email me about news, new arrivals and exclusive offers
              </label>
            </div>

            <Button type="submit" size="md" disabled={busy} loading={busy} className="w-full">
              {busy ? "Creating account…" : "Create account"}
            </Button>
          </form>
        )}
      </AuthShell>
    </div>
  );
}
