import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Copy, KeyRound, Monitor, ShieldCheck } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  FormSkeleton,
  Input,
  PasswordInput,
  toast,
} from "@bs/ui";
import { AccountCard } from "./account-card.tsx";
import { ChangePasswordDialog } from "../settings/change-password-dialog.tsx";
import { client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { disableMfa, finishMfaSetup, regenerateBackupCodes, startMfaSetup, type MfaSetup } from "../../lib/auth.ts";

export const EVENT_LABELS: Record<string, string> = {
  sign_in: "Signed in",
  password_changed: "Password changed",
  password_reset: "Password reset by email",
  mfa_enabled: "Authenticator app turned on",
  mfa_disabled: "Authenticator app turned off",
  backup_codes_regenerated: "New backup codes made",
  session_revoked: "A device was signed out",
  other_sessions_revoked: "Other devices were signed out",
};

export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function SecurityTab() {
  return (
    <div className="grid gap-4">
      <PasswordCard />
      <MfaCard />
      <SessionsCard />
    </div>
  );
}

function PasswordCard() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  return (
    <AccountCard title="Password" description="Use at least 10 characters. Changing it signs you out everywhere else.">
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <KeyRound className="mr-2 size-4" />
        Change password
      </Button>
      <ChangePasswordDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) void qc.invalidateQueries({ queryKey: ["admin", "account"] });
        }}
      />
    </AccountCard>
  );
}

type Step = "idle" | "password" | "scan" | "codes";

function MfaCard() {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["admin", "account"], queryFn: () => client.admin.account.get() });
  const enabled = profile.data?.twoFactorEnabled ?? false;
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [offPassword, setOffPassword] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenPassword, setRegenPassword] = useState("");
  const [shownCodes, setShownCodes] = useState<string[] | null>(null);

  function reset() {
    setStep("idle");
    setPassword("");
    setSetup(null);
    setQr(null);
    setCode("");
    setError(null);
    setBusy(false);
  }

  async function onStart(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await startMfaSetup(password);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setSetup(res.setup);
    setQr(await QRCode.toDataURL(res.setup.uri, { margin: 1, width: 192 }).catch(() => null));
    setPassword("");
    setStep("scan");
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await finishMfaSetup(code.replace(/\s/g, ""));
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setStep("codes");
    await qc.invalidateQueries({ queryKey: ["admin", "account"] });
    await qc.invalidateQueries({ queryKey: ["admin", "account", "security-events"] });
  }

  const off = useMutation({
    mutationFn: async () => {
      const res = await disableMfa(offPassword);
      if (!res.ok) throw new Error(res.message);
    },
    onSuccess: async () => {
      toast.success("Authenticator app turned off");
      setConfirmOff(false);
      setOffPassword("");
      await qc.invalidateQueries({ queryKey: ["admin", "account"] });
      await qc.invalidateQueries({ queryKey: ["admin", "account", "security-events"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const regen = useMutation({
    mutationFn: async () => {
      const res = await regenerateBackupCodes(regenPassword);
      if (!res.ok) throw new Error(res.message);
      return res.codes;
    },
    onSuccess: async (codes) => {
      setRegenOpen(false);
      setRegenPassword("");
      setShownCodes(codes);
      await qc.invalidateQueries({ queryKey: ["admin", "account", "security-events"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function copyCodes(codes: string[]) {
    void navigator.clipboard?.writeText(codes.join("\n")).then(() => toast.success("Codes copied"));
  }

  return (
    <AccountCard
      title="Two-step verification"
      description="Ask for a code from an authenticator app (Google Authenticator, Authy, 1Password) when you sign in. Optional, and strongly recommended for owners and admins."
      actions={enabled ? <Badge variant="secondary"><ShieldCheck className="mr-1 size-3" />On</Badge> : <Badge variant="outline">Off</Badge>}
    >
      {profile.isLoading ? (
        <FormSkeleton />
      ) : enabled ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setRegenOpen(true)}>
            Make new backup codes
          </Button>
          <Button variant="outline" onClick={() => setConfirmOff(true)}>
            Turn off
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">Your account is protected by your password only. Turn this on so a stolen password is not enough.</p>
          <div>
            <Button onClick={() => setStep("password")}>Set up authenticator app</Button>
          </div>
        </div>
      )}

      <Dialog open={step !== "idle"} onOpenChange={(o) => (!o && step !== "codes" ? reset() : undefined)}>
        <DialogContent className="sm:max-w-md">
          {step === "password" ? (
            <form onSubmit={onStart} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Confirm it is you</DialogTitle>
                <DialogDescription>Enter your password to start setting up the authenticator app.</DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor="mfa-pw">Password</FieldLabel>
                <PasswordInput id="mfa-pw" autoFocus required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={reset}>
                  Cancel
                </Button>
                <Button type="submit" loading={busy} disabled={!password}>
                  Continue
                </Button>
              </DialogFooter>
            </form>
          ) : null}
          {step === "scan" && setup ? (
            <form onSubmit={onVerify} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Scan with your authenticator app</DialogTitle>
                <DialogDescription>Scan the picture, or type the key by hand. Then enter the 6 digit code the app shows.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-2">
                {qr ? <img src={qr} alt="QR code for the authenticator app" width={192} height={192} className="rounded-md border border-border bg-white" /> : <div className="size-48 animate-pulse rounded-md bg-muted" />}
                <code className="break-all rounded bg-muted px-2 py-1 text-xs">{setup.secret}</code>
              </div>
              <Field>
                <FieldLabel htmlFor="mfa-code">6 digit code</FieldLabel>
                <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} />
                {error ? <FieldError>{error}</FieldError> : null}
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={reset}>
                  Cancel
                </Button>
                <Button type="submit" loading={busy} disabled={code.replace(/\s/g, "").length < 6}>
                  Turn on
                </Button>
              </DialogFooter>
            </form>
          ) : null}
          {step === "codes" && setup ? (
            <div className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Save your backup codes</DialogTitle>
                <DialogDescription>If you lose your phone, each code lets you sign in once. They are shown only now, so store them somewhere safe.</DialogDescription>
              </DialogHeader>
              <BackupCodes codes={setup.backupCodes} onCopy={() => copyCodes(setup.backupCodes)} />
              <DialogFooter>
                <Button onClick={reset}>I have saved them</Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={(o) => {
          setConfirmOff(o);
          if (!o) setOffPassword("");
        }}
        title="Turn off two-step verification?"
        description="Signing in will need only your password again."
        confirmLabel="Turn off"
        destructive
        pending={off.isPending}
        confirmDisabled={!offPassword}
        onConfirm={() => off.mutate()}
      >
        <Field>
          <FieldLabel htmlFor="mfa-off-pw">Password</FieldLabel>
          <PasswordInput id="mfa-off-pw" autoComplete="current-password" value={offPassword} onChange={(e) => setOffPassword(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={regenOpen}
        onOpenChange={(o) => {
          setRegenOpen(o);
          if (!o) setRegenPassword("");
        }}
        title="Make new backup codes?"
        description="Your current backup codes stop working as soon as new ones are made."
        confirmLabel="Make new codes"
        pending={regen.isPending}
        confirmDisabled={!regenPassword}
        onConfirm={() => regen.mutate()}
      >
        <Field>
          <FieldLabel htmlFor="mfa-regen-pw">Password</FieldLabel>
          <PasswordInput id="mfa-regen-pw" autoComplete="current-password" value={regenPassword} onChange={(e) => setRegenPassword(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <Dialog open={shownCodes !== null} onOpenChange={(o) => (!o ? setShownCodes(null) : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your new backup codes</DialogTitle>
            <DialogDescription>Each code works once. They are shown only now.</DialogDescription>
          </DialogHeader>
          {shownCodes ? <BackupCodes codes={shownCodes} onCopy={() => copyCodes(shownCodes)} /> : null}
          <DialogFooter>
            <Button onClick={() => setShownCodes(null)}>I have saved them</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AccountCard>
  );
}

function BackupCodes({ codes, onCopy }: { codes: string[]; onCopy: () => void }) {
  return (
    <div className="grid gap-2">
      <ul className="grid grid-cols-2 gap-1.5 rounded-md bg-muted p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onCopy}>
        <Copy className="mr-2 size-3.5" />
        Copy codes
      </Button>
    </div>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["admin", "account", "sessions"], queryFn: () => client.admin.account.sessions() });
  const [confirmAll, setConfirmAll] = useState(false);
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["admin", "account", "sessions"] }), qc.invalidateQueries({ queryKey: ["admin", "account", "security-events"] })]);
  const revoke = useMutation({
    mutationFn: (id: string) => client.admin.account.revokeSession({ id }),
    onSuccess: async () => {
      toast.success("Device signed out");
      await refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const revokeAll = useMutation({
    mutationFn: () => client.admin.account.revokeOtherSessions(),
    onSuccess: async (r) => {
      toast.success(r.count ? `Signed out ${r.count} other ${r.count === 1 ? "device" : "devices"}` : "No other devices were signed in");
      setConfirmAll(false);
      await refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const list = sessions.data ?? [];
  const others = list.filter((s) => !s.current).length;
  return (
    <AccountCard
      title="Where you are signed in"
      description="Devices that currently have access to your account. Sign out any you do not recognise."
      actions={
        others > 0 ? (
          <Button size="sm" variant="outline" onClick={() => setConfirmAll(true)}>
            Sign out all other devices
          </Button>
        ) : null
      }
    >
      {sessions.isLoading ? (
        <FormSkeleton />
      ) : list.length === 0 ? (
        <EmptyState icon={Monitor} title="No active sessions" description="" />
      ) : (
        <ul className="divide-y divide-border-soft">
          {list.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 text-sm">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  {s.device}
                  {s.current ? <Badge variant="secondary">This device</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.ip ?? "Unknown address"} · signed in {when(s.signedInAt)} · active {when(s.lastActiveAt)}
                </p>
              </div>
              {s.current ? null : (
                <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out all other devices?"
        description="You stay signed in here. Everywhere else will need to sign in again."
        confirmLabel="Sign them out"
        destructive
        pending={revokeAll.isPending}
        onConfirm={() => revokeAll.mutate()}
      />
    </AccountCard>
  );
}
