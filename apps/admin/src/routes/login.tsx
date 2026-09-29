import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button, Input, Label } from "@bs/ui";
import { fetchMe, signIn } from "../lib/auth.ts";

export const Route = createFileRoute("/login")({
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
      <form onSubmit={onSubmit} className="grid w-full max-w-sm gap-4 rounded-lg border border-border bg-background p-6 shadow-sm">
        <div className="grid gap-1">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="text-sm text-foreground-lighter">Use your store admin account.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
