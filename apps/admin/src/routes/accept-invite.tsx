import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { PageSkeleton } from "@bs/ui";
import { Button } from "@bs/ui";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@bs/ui";
import { Input } from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { errorMessage } from "../lib/errors.ts";
import { apiBase } from "../lib/config.ts";

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

  if (!token) {
    return (
      <Shell title="Invitation link incomplete">
        <FieldDescription>This link is missing an invitation token. Please check your invitation link or ask for a new invite.</FieldDescription>
      </Shell>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    const isOwnerInvite = !store;
    const needsPassword = isOwnerInvite || !existing;

    if (needsPassword) {
      if (password.length < 10) return setError("Choose a password of at least 10 characters.");
      if (password !== confirm) return setError("The two passwords do not match.");
    }

    setBusy(true);
    setError(null);
    try {
      if (store) {
        // Staff invite acceptance via store admin RPC
        await client.admin.memberships.acceptInvite({
          storeId: store,
          token,
          ...(existing ? {} : { name: name.trim() || undefined, password }),
        });
        await navigate({ to: "/login", search: { store } });
        return;
      }

      // Owner invite acceptance via central SaaS API
      const res = await fetch(`${apiBase()}/api/saas/invite/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password,
          name: name.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "This invitation link is invalid or has expired.");
      }

      const accepted = await res.json();
      await navigate({ to: "/login", search: { store: accepted.slug } });
    } catch (err) {
      setError(errorMessage(err, "This invitation link is invalid or has expired."));
      setBusy(false);
    }
  }

  const isOwnerInvite = !store;
  const showPassword = isOwnerInvite || !existing;

  return (
    <Shell title="Join the store">
      <form onSubmit={onSubmit}>
        <FieldGroup>
          {!showPassword ? (
            <FieldDescription>
              You will keep your existing password. After accepting, sign in with your usual email and password.
            </FieldDescription>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="name">Your name</FieldLabel>
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Choose a password</FieldLabel>
                <Input id="password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
                <FieldDescription>At least 10 characters.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="confirm">Repeat password</FieldLabel>
                <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
            </>
          )}
          {error ? <FieldError>{error}</FieldError> : null}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Working…" : !showPassword ? "Accept invitation" : "Create account and join"}
          </Button>
          {store ? (
            <Button type="button" variant="link" size="sm" className="justify-start px-0 text-muted-foreground" onClick={() => setExisting((v) => !v)}>
              {existing ? "I do not have an account yet" : "I already have an account with this email"}
            </Button>
          ) : null}
        </FieldGroup>
      </form>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-4">
      <div className="grid w-full max-w-sm gap-4 rounded-lg border border-border bg-background p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}
