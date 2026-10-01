import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { PageSkeleton } from "@bs/ui";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { fetchMe, requestPasswordReset } from "../lib/auth.ts";

export const Route = createFileRoute("/forgot-password")({
  pendingComponent: () => <PageSkeleton />,
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 0 }).catch(() => null);
    if (me) throw redirect({ to: "/" });
  },
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
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
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-dash-canvas p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-sm">
        {submitted ? (
          <div className="grid gap-4">
            <div className="grid gap-1">
              <h1 className="text-lg font-semibold">Check your email</h1>
              <p className="text-sm text-muted-foreground">
                If an account exists for <strong className="text-foreground">{email}</strong>, we have sent a link to reset your password. The link will expire in 1 hour.
              </p>
            </div>
            <div className="pt-2">
              <Link to="/login" className="text-xs text-primary hover:underline">
                Back to sign in
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <div className="grid gap-1">
                <h1 className="text-lg font-semibold">Reset password</h1>
                <FieldDescription>
                  Enter your email address and we will send you a link to reset your password.
                </FieldDescription>
              </div>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
              <Button type="submit" size="lg" disabled={busy || !email}>
                {busy ? "Sending link…" : "Send reset link"}
              </Button>
              <div className="text-center pt-2">
                <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                  Back to sign in
                </Link>
              </div>
            </FieldGroup>
          </form>
        )}
      </div>
    </div>
  );
}
