import React, { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Database } from "lucide-react";
import { Button, Input, Label } from "@bs/ui";
import { resetPassword } from "../lib/auth.ts";

export function ResetPassword({ token }: { token?: string }) {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-4 text-center">
            <h1 className="text-xl font-bold tracking-tight text-destructive">Invalid or Missing Token</h1>
            <p className="text-sm text-muted-foreground mt-1">
              This password reset link is invalid or has expired. Please request a new link.
            </p>
          </div>
          <div className="space-y-2">
            <Button asChild className="w-full">
              <Link to="/forgot-password">Request a new link</Link>
            </Button>
            <div className="text-center pt-2">
              <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 10) {
      setError("Password must be at least 10 characters long.");
      return;
    }
    if (newPassword.length > 128) {
      setError("Password cannot exceed 128 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);

    const res = await resetPassword(token, newPassword);
    setBusy(false);

    if (!res.ok) {
      setError(res.message);
      return;
    }

    setSuccess(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Database className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Set New Platform Password</h1>
          <p className="text-sm text-muted-foreground">Bs Commerce Super Admin Portal</p>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive font-medium border border-destructive/20">
            {error}
          </div>
        )}

        {success ? (
          <div className="space-y-4">
            <div className="rounded-md bg-emerald-500/10 p-4 text-sm text-emerald-700 border border-emerald-500/20 font-medium">
              Your password has been reset successfully. Please sign in with your new password and your second factor (TOTP / authenticator code).
            </div>
            <Button onClick={() => void navigate({ to: "/login" })} className="w-full">
              Proceed to Sign In
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="new-password">New Password (min 10 characters)</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="••••••••••••"
                minLength={10}
                maxLength={128}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="••••••••••••"
                minLength={10}
                maxLength={128}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            {error && error.includes("expired") ? (
              <Button asChild variant="ghost" className="w-full">
                <Link to="/forgot-password">Request a new link</Link>
              </Button>
            ) : (
              <Button type="submit" disabled={busy || !newPassword || !confirmPassword} className="w-full">
                {busy ? "Resetting password…" : "Reset Password"}
              </Button>
            )}
            <div className="text-center pt-2">
              <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
