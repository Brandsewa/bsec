import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AuthCardSkeleton, AuthShell, Button, Field, FieldError, FieldGroup, FieldLabel, Input } from "@bs/ui";
import { fetchMe, signIn } from "../lib/auth.ts";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
            <Input
              id="password"
              type="password"
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
        </FieldGroup>
      </form>
    </AuthShell>
  );
}
