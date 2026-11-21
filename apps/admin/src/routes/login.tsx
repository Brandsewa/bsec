import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthCardSkeleton, Button, Field, FieldError, FieldGroup } from "@bs/ui";
import { FloatingInput, FloatingPassword } from "../components/floating-input.tsx";
import { SplitAuthShell } from "../components/split-auth-shell.tsx";
import { apiBase } from "../lib/config.ts";
import { fetchMe, signIn, verifyBackupCode, verifyTotp } from "../lib/auth.ts";
import { fetchGoogleSignin, startGoogleSignIn, startOneTap } from "../lib/google.ts";
import { safeReturnTo } from "../lib/return-to.ts";

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
  // Where to go after sign-in (for example the AI app authorize screen). Only a path inside this app is kept.
  validateSearch: (s: Record<string, unknown>): { returnTo?: string; store?: string } => {
    const returnTo = safeReturnTo(s.returnTo);
    return { ...(returnTo ? { returnTo } : {}), ...(typeof s.store === "string" ? { store: s.store } : {}) };
  },
  pendingComponent: () => <AuthCardSkeleton />,
  beforeLoad: async ({ context, search }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 0 }).catch(() => null);
    if (me) {
      if (search.returnTo) window.location.assign(search.returnTo);
      throw redirect({ to: "/" });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { returnTo } = Route.useSearch();
  /** After sign-in: back to where the user was heading, else the dashboard. */
  const afterSignIn = async () => {
    if (returnTo) {
      window.location.assign(returnTo);
      return;
    }
    await navigate({ to: "/" });
  };
  const { queryClient } = Route.useRouteContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => (typeof window !== "undefined" ? googleErrorMessage(window.location.search) : null));
  const [busy, setBusy] = useState(false);
  // Set once the password is accepted and the account has an authenticator: the next screen asks for the code.
  const [needCode, setNeedCode] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState("");

  const { data: google } = useQuery({ queryKey: ["google-signin"], queryFn: fetchGoogleSignin, staleTime: 60_000 });
  const googleOn = Boolean(google?.enabled);

  useEffect(() => {
    if (!google?.enabled || !google.oneTap || !google.clientId) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void startOneTap(google.clientId, () => {
      queryClient.clear();
      if (returnTo) window.location.assign(returnTo);
      else void navigate({ to: "/" });
    }).then((stop) => {
      if (cancelled) stop();
      else cleanup = stop;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [google, navigate, queryClient, returnTo]);

  async function onGoogle() {
    setError(null);
    const res = await startGoogleSignIn(returnTo);
    if (res.message) setError(res.message);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn(email.trim(), password);
    if (!res.ok) {
      if (res.twoFactorRequired) {
        setNeedCode(true);
        setBusy(false);
        return;
      }
      setError(res.message);
      setBusy(false);
      return;
    }
    queryClient.clear();
    await afterSignIn();
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await (useBackup ? verifyBackupCode(code.trim()) : verifyTotp(code.replace(/\s/g, "")));
    if (!res.ok) {
      setError(res.message);
      setBusy(false);
      return;
    }
    queryClient.clear();
    await afterSignIn();
  }

  if (needCode) {
    return (
      <SplitAuthShell>
        <form onSubmit={onSubmitCode} className="space-y-5">
          <FieldGroup>
            <h1 className="text-xl font-semibold">{useBackup ? "Use a backup code" : "Two-step verification"}</h1>
            <p className="text-sm text-muted-foreground">
              {useBackup ? "Enter one of the backup codes you saved when you turned on the authenticator. Each code works once." : "Enter the 6 digit code from your authenticator app."}
            </p>
            <Field>
              <FloatingInput
                id="code"
                label={useBackup ? "Backup code" : "6 digit code"}
                inputMode={useBackup ? "text" : "numeric"}
                autoComplete="one-time-code"
                required
                value={code}
                onChange={setCode}
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            <Button type="submit" size="lg" className="h-14 w-full text-base" disabled={busy || !code.trim()} loading={busy}>
              {busy ? "Checking…" : "Verify"}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => { setUseBackup((v) => !v); setCode(""); setError(null); }}>
                {useBackup ? "Use the authenticator app" : "Use a backup code"}
              </button>
              <button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => { setNeedCode(false); setUseBackup(false); setCode(""); setPassword(""); setError(null); }}>
                Back to sign in
              </button>
            </div>
          </FieldGroup>
        </form>
      </SplitAuthShell>
    );
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
