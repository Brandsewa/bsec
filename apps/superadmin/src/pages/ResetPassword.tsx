import React, { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Database } from "lucide-react";
import { AuthShell, Button, Input, Label } from "@bs/ui";
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
      <AuthShell
        brand={{
          logo: <Database className="h-6 w-6 text-primary" />,
          name: "Bs Commerce",
        }}
        title="Invalid or Missing Token"
        description="This password reset link is invalid or has expired. Please request a new link."
        variant="platform"
      >
        <div className="space-y-4">
          <Button render={<Link to="/forgot-password" />} className="w-full">
            Request a new link
          </Button>
          <div className="text-center pt-2">
            <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
              Back to sign in
            </Link>
          </div>
        </div>
      </AuthShell>
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
    <AuthShell
      brand={{
        logo: <Database className="h-6 w-6 text-primary" />,
        name: "Bs Commerce",
      }}
      title="Set New Platform Password"
      description="Bs Commerce Super Admin Portal"
      variant="platform"
    >
      <div>
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
              <Button render={<Link to="/forgot-password" />} variant="ghost" className="w-full">
                Request a new link
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
    </AuthShell>
  );
}
