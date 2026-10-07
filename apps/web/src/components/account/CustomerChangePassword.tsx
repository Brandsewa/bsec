"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, FieldLabel, Input, Alert, AlertDescription, ConfirmDialog } from "@bs/ui";

export function CustomerChangePassword() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showConfirmLogout, setShowConfirmLogout] = useState(false);

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
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        ) : null}

        {success ? (
          <Alert variant="default" className="border-[var(--brand)] bg-[var(--brand-soft)]">
            <AlertDescription className="text-xs text-[var(--foreground)]">
              Password changed successfully! Other devices have been signed out.
            </AlertDescription>
          </Alert>
        ) : null}

        <Field className="space-y-1.5">
          <FieldLabel htmlFor="current-pw">Current password</FieldLabel>
          <div className="relative">
            <Input
              id="current-pw"
              required
              type={showPassword ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className="h-10 sm:h-9 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] p-1 text-xs"
            >
              {showPassword ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
        </Field>

        <Field className="space-y-1.5">
          <FieldLabel htmlFor="next-pw">New password</FieldLabel>
          <Input
            id="next-pw"
            required
            type={showPassword ? "text" : "password"}
            minLength={10}
            maxLength={128}
            value={nextPassword}
            onChange={(e) => setNextPassword(e.target.value)}
            autoComplete="new-password"
            className="h-10 sm:h-9"
          />
          <span className="block text-[11px] text-[var(--muted-foreground)]">Minimum 10 characters.</span>
        </Field>

        <Field className="space-y-1.5">
          <FieldLabel htmlFor="confirm-pw">Confirm new password</FieldLabel>
          <Input
            id="confirm-pw"
            required
            type={showPassword ? "text" : "password"}
            minLength={10}
            maxLength={128}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            className="h-10 sm:h-9"
          />
        </Field>

        <Button type="submit" size="md" disabled={busy} loading={busy}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </form>

      <div className="border-t border-[var(--border)] pt-6">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">Active sessions</h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">Sign out of all other browsers and devices.</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setShowConfirmLogout(true)}
          className="mt-3"
        >
          Sign out of all devices
        </Button>
      </div>

      <ConfirmDialog
        open={showConfirmLogout}
        onOpenChange={setShowConfirmLogout}
        title="Sign out of all devices?"
        description="Are you sure you want to sign out of all active sessions across all devices?"
        confirmLabel="Sign out everywhere"
        destructive
        onConfirm={handleSignOutAll}
      />
    </div>
  );
}
