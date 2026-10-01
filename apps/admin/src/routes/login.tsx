import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { PageSkeleton } from "@bs/ui";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { fetchMe, signIn } from "../lib/auth.ts";

export const Route = createFileRoute("/login")({
  pendingComponent: () => <PageSkeleton />,
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
    <div className="grid min-h-dvh place-items-center bg-dash-canvas p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-sm">
        <FieldGroup>
          <div className="grid gap-1">
            <h1 className="text-lg font-semibold">Sign in</h1>
            <FieldDescription>Use your store admin account.</FieldDescription>
          </div>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
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
          <Button type="submit" size="lg" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}
