import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Database } from "lucide-react";
import { AuthShell, Button, Input, Label } from "@bs/ui";
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
    <AuthShell
      brand={{
        logo: <Database className="h-6 w-6 text-primary" />,
        name: "Bs Commerce",
      }}
      title="Reset Platform Password"
      description="Bs Commerce Super Admin Portal"
      variant="platform"
    >
      <div>
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
    </AuthShell>
  );
}
