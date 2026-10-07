import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AuthCardSkeleton, AuthShell, Button, Field, FieldError, FieldGroup, FieldLabel, Input } from "@bs/ui";
import { fetchMe, requestPasswordReset } from "../lib/auth.ts";

export const Route = createFileRoute("/forgot-password")({
  pendingComponent: () => <AuthCardSkeleton />,
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
    <AuthShell
      variant="platform"
      brand={{ name: "Bs Commerce" }}
      title={submitted ? "Check your email" : "Reset password"}
      description={
        submitted
          ? `If an account exists for ${email}, we have sent a link to reset your password. The link will expire in 1 hour.`
          : "Enter your email address and we will send you a link to reset your password."
      }
      footer={
        <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          Back to sign in
        </Link>
      }
    >
      {submitted ? (
        <div className="pt-2 text-center">
          <Link to="/login" className="text-sm font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <FieldGroup>
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
            <Button type="submit" size="md" className="w-full" disabled={busy || !email} loading={busy}>
              {busy ? "Sending link…" : "Send reset link"}
            </Button>
          </FieldGroup>
        </form>
      )}
    </AuthShell>
  );
}
