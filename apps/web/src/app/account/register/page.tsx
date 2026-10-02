"use client";

import React, { useState } from "react";
import Link from "next/link";

const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

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
          email,
          phone: phone || undefined,
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
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8" data-testid="register-form">
      <h1 className="text-2xl font-extrabold text-foreground">Create account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sign up to track orders, save multiple addresses, and checkout faster.</p>

      {registered ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg bg-primary/10 p-4 text-center text-sm font-medium text-primary">
            An account setup link has been sent to <strong className="text-foreground">{email}</strong>. Please check your inbox and click the link to set your password and complete your registration.
          </div>
          <Link
            href="/account/login"
            className="block text-center text-sm font-semibold text-primary hover:underline"
          >
            Return to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleRegister} className="mt-5 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">Full name (optional)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              autoComplete="name"
              placeholder="Your name"
            />
          </label>

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

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">Phone number (optional)</span>
            <input
              inputMode="numeric"
              pattern="[6-9][0-9]{9}"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              className={inputClass}
              autoComplete="tel-national"
              placeholder="10-digit number"
            />
            <span className="mt-1 block text-xs text-muted-foreground">Mandatory only at checkout for delivery.</span>
          </label>

          <label className="flex items-start gap-2 pt-1 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={acceptsMarketing}
              onChange={(e) => setAcceptsMarketing(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <span>Email me about news, new arrivals and exclusive offers</span>
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
            {busy ? "Creating account…" : "Create account"}
          </button>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link href="/account/login" className="font-semibold text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
