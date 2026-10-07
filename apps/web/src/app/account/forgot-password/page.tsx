"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AuthShell, Button, Field, FieldLabel, Input, Alert, AlertDescription } from "@bs/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/storefront/customer/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to request password reset");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="forgot-password-form">
      <AuthShell
        variant="store"
        brand={{ name: "Store" }}
        title="Forgot password"
        description="Enter your email and we will send you a link to reset your password."
        footer={
          <span>
            Remember your password?{" "}
            <Link href="/account/login" className="font-semibold text-[var(--brand-ink)] hover:underline">
              Sign in
            </Link>
          </span>
        }
      >
        {submitted ? (
          <div className="space-y-4">
            <Alert variant="default" className="border-[var(--brand)] bg-[var(--brand-soft)]">
              <AlertDescription className="text-xs text-[var(--foreground)]">
                If an account with this email exists, a password reset link has been sent. Please check your inbox.
              </AlertDescription>
            </Alert>
            <Button asChild size="md" className="w-full">
              <Link href="/account/login">Back to sign in</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            ) : null}

            <Field className="space-y-1.5">
              <FieldLabel htmlFor="forgot-email">Email address</FieldLabel>
              <Input
                id="forgot-email"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                className="h-10 sm:h-9"
              />
            </Field>

            <Button type="submit" size="md" disabled={busy} loading={busy} className="w-full">
              {busy ? "Sending link…" : "Send reset link"}
            </Button>
          </form>
        )}
      </AuthShell>
    </div>
  );
}
