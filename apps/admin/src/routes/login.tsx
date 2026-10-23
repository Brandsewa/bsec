import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthCardSkeleton, AuthShell, Button, Field, FieldError, FieldGroup, FieldLabel, Input } from "@bs/ui";
import { PasswordInput } from "@bs/ui";
import { fetchMe, signIn } from "../lib/auth.ts";
import { fetchGoogleSignin, startGoogleSignIn, startOneTap } from "../lib/google.ts";

export const Route = createFileRoute("/login")({
  pendingComponent: () => <AuthCardSkeleton />,
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 0 }).catch(() => null);
    if (me) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { queryClient } = Route.useRouteContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("google_error")
      ? "Google sign-in did not work for this account. Sign in with your email and password."
      : null,
  );
  const [busy, setBusy] = useState(false);

  const { data: google } = useQuery({ queryKey: ["google-signin"], queryFn: fetchGoogleSignin, staleTime: 60_000 });
  const googleOn = Boolean(google?.enabled);

  useEffect(() => {
    if (!google?.enabled || !google.oneTap || !google.clientId) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void startOneTap(google.clientId, () => {
      queryClient.clear();
      void navigate({ to: "/" });
    }).then((stop) => {
      if (cancelled) stop();
      else cleanup = stop;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [google, navigate, queryClient]);

  async function onGoogle() {
    setError(null);
    const res = await startGoogleSignIn();
    if (res.message) setError(res.message);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn(email.trim(), password);
    if (!res.ok) {
      setError(res.message);
      setBusy(false);
      return;
    }
    queryClient.clear();
    await navigate({ to: "/" });
  }

  return (
    <AuthShell
      variant="platform"
      brand={{ name: "Bs Commerce" }}
      title="Sign in"
      description="Use your store admin account."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Button type="submit" size="md" className="w-full" disabled={busy || !email || !password} loading={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          {googleOn ? (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button type="button" variant="outline" size="md" className="w-full" onClick={() => void onGoogle()}>
                Continue with Google
              </Button>
            </>
          ) : null}
        </FieldGroup>
      </form>
    </AuthShell>
  );
}
