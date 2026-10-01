import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Database } from "lucide-react";
import { Button, Input, Label } from "@bs/ui";
import { requestPasswordReset } from "../lib/auth.ts";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);

    const res = await requestPasswordReset(email.trim());
    setBusy(false);
    if (!res.ok && res.retryAfter) {
      setError(res.message);
      return;
    }
    setSubmitted(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Database className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Reset Platform Password</h1>
          <p className="text-sm text-muted-foreground">Bs Commerce Super Admin Portal</p>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive font-medium border border-destructive/20">
            {error}
          </div>
        )}

        {submitted ? (
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
              If an account exists for <strong className="text-foreground">{email}</strong>, a password reset link has been sent. The link expires in 1 hour.
            </div>
            <div className="text-center pt-2">
              <Link to="/login" className="text-sm text-primary hover:underline">
                Back to sign in
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Platform Staff Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="staff@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <Button type="submit" disabled={busy || !email} className="w-full">
              {busy ? "Sending link…" : "Send Reset Link"}
            </Button>
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
