"use client";

import React, { useState } from "react";
import Link from "next/link";

const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

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
        body: JSON.stringify({ email }),
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
    <div className="mx-auto max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8" data-testid="forgot-password-form">
      <h1 className="text-2xl font-extrabold text-foreground">Forgot password</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enter your email and we will send you a link to reset your password.</p>

      {submitted ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg bg-primary/10 p-4 text-center text-sm font-medium text-primary">
            If an account with this email exists, a password reset link has been sent. Please check your inbox.
          </div>
          <Link
            href="/account/login"
            className="block text-center text-sm font-semibold text-primary hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">Email address</span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Sending link…" : "Send reset link"}
          </button>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Remember your password?{" "}
            <Link href="/account/login" className="font-semibold text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
