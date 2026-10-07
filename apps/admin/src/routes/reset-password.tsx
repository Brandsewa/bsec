import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AuthCardSkeleton, AuthShell, Button, buttonVariants, Field, FieldError, FieldGroup, FieldLabel, Input } from "@bs/ui";
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
      <AuthShell
        variant="platform"
        brand={{ name: "Bs Commerce" }}
        title="Invalid or missing token"
        description="This password reset link is invalid or has expired. Please request a new one."
        footer={
          <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="flex flex-col gap-3">
          <Link to="/forgot-password" className={buttonVariants({ size: "md", className: "w-full text-center" })}>
            Request a new link
          </Link>
        </div>
      </AuthShell>
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
    <AuthShell
      variant="platform"
      brand={{ name: "Bs Commerce" }}
      title={success ? "Password reset successful" : "Set new password"}
      description={
        success
          ? "Your password has been reset successfully. You can now sign in with your new credentials."
          : "Choose a strong password with at least 10 characters."
      }
      footer={
        <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          Back to sign in
        </Link>
      }
    >
      {success ? (
        <div className="pt-2">
          <Button onClick={() => void navigate({ to: "/login" })} size="md" className="w-full">
            Sign in
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                autoFocus
                minLength={10}
                maxLength={128}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={128}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            {error && error.includes("expired") ? (
              <Link to="/forgot-password" className={buttonVariants({ variant: "outline", size: "md", className: "w-full text-center" })}>
                Request a new link
              </Link>
            ) : (
              <Button type="submit" size="md" className="w-full" disabled={busy || !newPassword || !confirmPassword} loading={busy}>
                {busy ? "Resetting password…" : "Reset password"}
              </Button>
            )}
          </FieldGroup>
        </form>
      )}
    </AuthShell>
  );
}
