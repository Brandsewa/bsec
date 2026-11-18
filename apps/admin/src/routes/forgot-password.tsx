import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AuthCardSkeleton, Button, Field, FieldError, FieldGroup } from "@bs/ui";
import { FloatingInput } from "../components/floating-input.tsx";
import { SplitAuthShell } from "../components/split-auth-shell.tsx";
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
    <SplitAuthShell
      {...(submitted
        ? {
            title: "Check your email",
            description: `If an account exists for ${email}, we have sent a link to reset your password. The link will expire in 1 hour.`,
          }
        : {})}
    >
      {submitted ? (
        <div className="text-center text-sm">
          <Link to="/login" className="text-muted-foreground hover:text-foreground hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <FieldGroup>
            <div className="flex items-center justify-between text-sm">
              <h1 className="font-semibold text-foreground">Reset your password</h1>
              <Link to="/login" className="text-muted-foreground hover:text-foreground hover:underline">
                Back to sign in
              </Link>
            </div>
            <Field>
              <FloatingInput id="email" label="Email" type="email" autoComplete="username" required value={email} onChange={setEmail} />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            <Button type="submit" size="lg" className="h-14 w-full text-base" disabled={busy || !email} loading={busy}>
              {busy ? "Sending link…" : "Send reset link"}
            </Button>
            <p className="text-sm text-muted-foreground">Enter your email address and we will send you a link to reset your password.</p>
          </FieldGroup>
        </form>
      )}
    </SplitAuthShell>
  );
}
