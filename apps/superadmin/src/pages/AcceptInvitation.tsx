import React, { useState } from "react";
import { Database } from "lucide-react";
import { AuthShell, Button, Input, Label } from "@bs/ui";
import { acceptStaffInvitation } from "../lib/auth.ts";

/** Public page: a platform staff invitation is accepted here (choose a password, then sign in and set up MFA). */
export function AcceptInvitation() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await acceptStaffInvitation(token, password, name.trim());
    setBusy(false);
    if (res.ok) setDoneEmail(res.email);
    else setError(res.message);
  };

  return (
    <AuthShell
      brand={{
        logo: <Database className="h-6 w-6 text-primary" />,
        name: "Bs Commerce",
      }}
      title="Join the platform team"
      description="Accept your Super Admin invitation"
      variant="platform"
    >
      <div>
        {!token ? (
          <p role="alert" className="text-sm text-destructive">This invitation link is incomplete. Ask a platform owner to send it again.</p>
        ) : doneEmail ? (
          <div className="space-y-3 text-sm">
            <p role="status" className="rounded-md bg-emerald-500/10 p-3 text-emerald-700 border border-emerald-500/20">
              Invitation accepted for <strong>{doneEmail}</strong>. Sign in with your password; you will set up your authenticator app on the first sign-in.
            </p>
            <a className="text-primary underline" href="/login">Go to sign in</a>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && (
              <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive border border-destructive/20">{error}</div>
            )}
            <div>
              <Label htmlFor="name">Your name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div>
              <Label htmlFor="password">Choose a password (10+ characters)</Label>
              <Input id="password" type="password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
              <p className="mt-1 text-xs text-muted-foreground">If you already have an account with this email, enter its current password instead: it is not changed.</p>
            </div>
            <Button type="submit" className="w-full" disabled={busy || password.length < 10}>
              {busy ? "Accepting..." : "Accept invitation"}
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
