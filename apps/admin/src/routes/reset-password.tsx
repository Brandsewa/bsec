import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { PageSkeleton } from "@bs/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { fetchMe, resetPassword } from "../lib/auth.ts";

export const Route = createFileRoute("/reset-password")({
  pendingComponent: () => <PageSkeleton />,
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
      <div className="grid min-h-dvh place-items-center bg-dash-canvas p-4">
        <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-sm">
          <div className="grid gap-4">
            <div className="grid gap-1">
              <h1 className="text-lg font-semibold text-destructive">Invalid or missing token</h1>
              <p className="text-sm text-muted-foreground">
                This password reset link is invalid or has expired. Please request a new one.
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Link to="/forgot-password" className={buttonVariants({ size: "sm" })}>
                Request a new link
              </Link>
              <Link to="/login" className="text-center text-xs text-muted-foreground hover:text-foreground hover:underline">
                Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
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
    <div className="grid min-h-dvh place-items-center bg-dash-canvas p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-sm">
        {success ? (
          <div className="grid gap-4">
            <div className="grid gap-1">
              <h1 className="text-lg font-semibold text-emerald-600">Password reset successful</h1>
              <p className="text-sm text-muted-foreground">
                Your password has been reset successfully. You can now sign in with your new credentials.
              </p>
            </div>
            <Button onClick={() => void navigate({ to: "/login" })} size="lg">
              Sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <div className="grid gap-1">
                <h1 className="text-lg font-semibold">Set new password</h1>
                <FieldDescription>Choose a strong password with at least 10 characters.</FieldDescription>
              </div>
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
              {error ? (
                <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive font-medium border border-destructive/20">
                  {error}
                </div>
              ) : null}
              {error && error.includes("expired") ? (
                <Link to="/forgot-password" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Request a new link
                </Link>
              ) : (
                <Button type="submit" size="lg" disabled={busy || !newPassword || !confirmPassword}>
                  {busy ? "Resetting password…" : "Reset password"}
                </Button>
              )}
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
