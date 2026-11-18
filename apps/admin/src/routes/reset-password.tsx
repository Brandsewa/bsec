import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AuthCardSkeleton, Button, buttonVariants, Field, FieldError, FieldGroup } from "@bs/ui";
import { FloatingPassword } from "../components/floating-input.tsx";
import { SplitAuthShell } from "../components/split-auth-shell.tsx";
import { fetchMe, resetPassword } from "../lib/auth.ts";

export const Route = createFileRoute("/reset-password")({
  pendingComponent: () => <AuthCardSkeleton />,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 0 }).catch(() => null);
    if (me) throw redirect({ to: "/" });
  },
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <SplitAuthShell title="Invalid or missing link" description="This password reset link is invalid or has expired. Please request a new one.">
        <div className="space-y-5">
          <Link to="/forgot-password" className={buttonVariants({ size: "lg", className: "h-14 w-full text-center text-base" })}>
            Request a new link
          </Link>
          <div className="text-sm">
            <Link to="/login" className="text-muted-foreground hover:text-foreground hover:underline">
              Back to sign in
            </Link>
          </div>
        </div>
      </SplitAuthShell>
    );
  }

  async function onSubmit(e: FormEvent) {
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
  }

  return (
    <SplitAuthShell
      title={success ? "Password reset" : "Set a new password"}
      description={
        success
          ? "Your password has been reset. You can now sign in with your new credentials."
          : "Choose a strong password with at least 10 characters."
      }
    >
      {success ? (
        <Button onClick={() => void navigate({ to: "/login" })} size="lg" className="h-14 w-full text-base">
          Sign in
        </Button>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <FieldGroup>
            <Field>
              <FloatingPassword id="new-password" label="New password" autoComplete="new-password" required value={newPassword} onChange={setNewPassword} />
            </Field>
            <Field>
              <FloatingPassword id="confirm-password" label="Confirm new password" autoComplete="new-password" required value={confirmPassword} onChange={setConfirmPassword} />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            {error && error.includes("expired") ? (
              <Link to="/forgot-password" className={buttonVariants({ variant: "outline", size: "lg", className: "h-14 w-full text-center text-base" })}>
                Request a new link
              </Link>
            ) : (
              <Button type="submit" size="lg" className="h-14 w-full text-base" disabled={busy || !newPassword || !confirmPassword} loading={busy}>
                {busy ? "Resetting password…" : "Reset password"}
              </Button>
            )}
            <div className="text-sm">
              <Link to="/login" className="text-muted-foreground hover:text-foreground hover:underline">
                Back to sign in
              </Link>
            </div>
          </FieldGroup>
        </form>
      )}
    </SplitAuthShell>
  );
}
