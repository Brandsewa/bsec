"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export function CustomerChangePassword() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (nextPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/storefront/customer/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, nextPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to change password");

      setSuccess(true);
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOutAll() {
    if (!confirm("Are you sure you want to sign out of all devices?")) return;
    try {
      await fetch("/api/storefront/customer/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      router.push("/account/login");
      router.refresh();
    } catch {
      router.push("/account/login");
    }
  }

  return (
    <div className="space-y-6" data-testid="change-password-section">
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">Current password</span>
          <input
            required
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
            autoComplete="current-password"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">New password</span>
          <input
            required
            type="password"
            minLength={10}
            maxLength={128}
            value={nextPassword}
            onChange={(e) => setNextPassword(e.target.value)}
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

        {success ? (
          <p className="text-sm font-medium text-primary">
            Password changed successfully! Other devices have been signed out.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>

      <div className="border-t border-border pt-6">
        <h3 className="text-sm font-bold text-foreground">Active sessions</h3>
        <p className="mt-1 text-xs text-muted-foreground">Sign out of all other browsers and devices.</p>
        <button
          type="button"
          onClick={handleSignOutAll}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
        >
          Sign out of all devices
        </button>
      </div>
    </div>
  );
}
