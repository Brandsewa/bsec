import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthCardSkeleton, Button, Field, FieldError, FieldGroup } from "@bs/ui";
import { FloatingInput, FloatingPassword } from "../components/floating-input.tsx";
import { SplitAuthShell } from "../components/split-auth-shell.tsx";
import { apiBase } from "../lib/config.ts";
import { fetchMe, signIn } from "../lib/auth.ts";
import { fetchGoogleSignin, startGoogleSignIn, startOneTap } from "../lib/google.ts";

function googleErrorMessage(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.has("google_error") && !params.has("error")) return null;
  const code = params.get("error") ?? "";
  if (code === "signup_disabled" || code === "user_not_found") {
    return "No account was found for that Google email. Sign in with the email you registered with, or sign up first.";
  }
  if (code === "account_not_linked" || code === "unable_to_link_account") {
    return "This Google account could not be linked to your account. Sign in with your email and password.";
  }
  return `Google sign-in did not work${code ? ` (${code})` : ""}. Sign in with your email and password.`;
}

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
  const [error, setError] = useState<string | null>(() => (typeof window !== "undefined" ? googleErrorMessage(window.location.search) : null));
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
    <SplitAuthShell>
      <form onSubmit={onSubmit} className="space-y-5">
        <FieldGroup>
          <h1 className="sr-only">Sign in</h1>
          <Field>
            <FloatingInput id="email" label="Email" type="email" autoComplete="username" required value={email} onChange={setEmail} />
          </Field>
          <Field>
            <FloatingPassword id="password" label="Password" autoComplete="current-password" required value={password} onChange={setPassword} />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Button type="submit" size="lg" className="h-14 w-full text-base" disabled={busy || !email || !password} loading={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <a href={`${apiBase()}/signup`} className="text-muted-foreground hover:text-foreground hover:underline">
              New registration
            </a>
            <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground hover:underline">
              Forgot password?
            </Link>
          </div>
          {googleOn ? (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button type="button" variant="outline" size="lg" className="h-14 w-full text-base" onClick={() => void onGoogle()}>
                Continue with Google
              </Button>
            </>
          ) : null}
        </FieldGroup>
      </form>
    </SplitAuthShell>
  );
}
