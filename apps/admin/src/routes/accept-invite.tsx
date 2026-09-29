import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button, Input, Label, PageSkeleton } from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { errorMessage } from "../lib/errors.ts";

interface Search {
  store?: string;
  token?: string;
}

export const Route = createFileRoute("/accept-invite")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s.store === "string" ? { store: s.store } : {}),
    ...(typeof s.token === "string" ? { token: s.token } : {}),
  }),
  pendingComponent: () => <PageSkeleton />,
  component: AcceptInvitePage,
});

export function AcceptInvitePage() {
  const { store, token } = Route.useSearch();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [existing, setExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!store || !token) {
    return (
      <Shell title="Invitation link incomplete">
        <p className="text-sm text-foreground-lighter">This link is missing information. Ask the store owner to send a new invitation.</p>
      </Shell>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!store || !token) return;
    if (!existing) {
      if (password.length < 10) return setError("Choose a password of at least 10 characters.");
      if (password !== confirm) return setError("The two passwords do not match.");
    }
    setBusy(true);
    setError(null);
    try {
      await client.admin.memberships.acceptInvite({
        storeId: store,
        token,
        ...(existing ? {} : { name: name.trim() || undefined, password }),
      });
      await navigate({ to: "/login" });
    } catch (err) {
      setError(errorMessage(err, "This invitation link is invalid or has expired."));
      setBusy(false);
    }
  }

  return (
    <Shell title="Join the store">
      <form onSubmit={onSubmit} className="grid gap-4">
        {existing ? (
          <p className="text-sm text-foreground-lighter">
            You will keep your existing password. After accepting, sign in with your usual email and password.
          </p>
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Choose a password</Label>
              <Input id="password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="text-xs text-foreground-lighter">At least 10 characters.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confirm">Repeat password</Label>
              <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          </>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Working…" : existing ? "Accept invitation" : "Create account and join"}
        </Button>
        <button type="button" className="text-left text-xs text-foreground-lighter underline" onClick={() => setExisting((v) => !v)}>
          {existing ? "I do not have an account yet" : "I already have an account with this email"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-dash-canvas p-4">
      <div className="grid w-full max-w-sm gap-4 rounded-lg border border-border bg-background p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}
