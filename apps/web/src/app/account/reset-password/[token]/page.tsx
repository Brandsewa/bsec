"use client";

import React, { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell, Button, Field, FieldLabel, Input, Alert, AlertDescription } from "@bs/ui";

export default function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <div data-testid="reset-password-form">
      <AuthShell
        variant="store"
        brand={{ name: "Store" }}
        title="Reset password"
        description="Enter a new secure password for your account."
        footer={
          <Link href="/account/forgot-password" className="text-xs text-[var(--brand-ink)] hover:underline">
            Request a new link
          </Link>
        }
      >
        {success ? (
          <Alert variant="default" className="border-[var(--brand)] bg-[var(--brand-soft)]">
            <AlertDescription className="text-xs text-[var(--foreground)]">
              Your password has been reset successfully! Redirecting to sign in…
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            ) : null}

            <Field className="space-y-1.5">
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <div className="relative">
                <Input
                  id="new-password"
                  required
                  type={showPassword ? "text" : "password"}
                  minLength={10}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
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
              <span className="block text-[11px] text-[var(--muted-foreground)]">Minimum 10 characters.</span>
            </Field>

            <Field className="space-y-1.5">
              <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
              <Input
                id="confirm-password"
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

            <Button type="submit" size="md" disabled={busy} loading={busy} className="w-full">
              {busy ? "Resetting…" : "Reset password"}
            </Button>
          </form>
        )}
      </AuthShell>
    </div>
  );
}
