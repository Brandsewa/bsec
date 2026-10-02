"use client";

import React, { useState } from "react";
import Link from "next/link";

interface CreateAccountCardProps {
  email: string;
  name?: string;
  phone?: string;
}

export function CreateAccountCard({ email, name, phone }: CreateAccountCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/storefront/customer/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name, phone }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to create account");

      setCreated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-6 text-left shadow-sm">
        <h3 className="font-bold text-foreground">Account setup link sent!</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ve sent an account setup link to <strong className="text-foreground">{email}</strong>. Check your inbox to set your password. Once complete, all orders placed with this email will be linked to your account.
        </p>
        <Link href="/account/login" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
          Go to sign in →
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-2xl border border-border bg-card p-6 text-left shadow-sm">
      <h3 className="text-base font-bold text-foreground">Save your details for next time</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Create an account with <strong className="text-foreground">{email}</strong> to easily track this order and speed up future checkouts.
      </p>

      <form onSubmit={handleCreate} className="mt-4 space-y-3">
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Sending setup link…" : "Create account"}
        </button>
      </form>
    </div>
  );
}
