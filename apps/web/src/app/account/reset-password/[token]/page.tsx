"use client";

import React, { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export default function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/storefront/customer/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to reset password. The link may have expired.");
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/account/login");
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8" data-testid="reset-password-form">
      <h1 className="text-2xl font-extrabold text-foreground">Reset password</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enter a new secure password for your account.</p>

      {success ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg bg-primary/10 p-4 text-center text-sm font-medium text-primary">
            Your password has been reset successfully! Redirecting to sign in…
          </div>
        </div>
      ) : (
        <form onSubmit={handleReset} className="mt-5 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">New password</span>
            <input
              required
              type="password"
              minLength={10}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
            />
            <span className="mt-1 block text-xs text-muted-foreground">Minimum 10 characters.</span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">Confirm new password</span>
            <input
              required
              type="password"
              minLength={10}
              maxLength={128}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
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
            {busy ? "Resetting…" : "Reset password"}
          </button>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            <Link href="/account/forgot-password" className="text-primary hover:underline">
              Request a new link
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
