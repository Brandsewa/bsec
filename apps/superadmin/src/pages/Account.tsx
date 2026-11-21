import React, { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Headphones, ShieldCheck } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Input,
  PageContainer,
  PageHeader,
  PasswordInput,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { changePassword, regenerateBackupCodes } from "../lib/auth.ts";
import { messageOf } from "../lib/errors.ts";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const EVENT_LABELS: Record<string, string> = {
  sign_in: "Signed in",
  password_changed: "Password changed",
  password_reset: "Password reset by email",
  mfa_enabled: "Authenticator app turned on",
  backup_codes_regenerated: "New backup codes made",
  session_revoked: "A device was signed out",
  other_sessions_revoked: "Other devices were signed out",
};

/** Readable form of an audit action such as platform_staff.update_role. */
const actionLabel = (a: string) => a.replace(/^platform_/, "").replace(/[._]/g, " ");

export function Account() {
  return (
    <PageContainer>
      <PageHeader title="My account" description="Your profile, sign-in security, role and recent actions." />
      <Tabs defaultValue="profile" className="mt-2 flex w-full flex-col">
        <TabsList className="mb-2">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="access">Role and access</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-4">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="security" className="mt-4">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="access" className="mt-4">
          <AccessTab />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="max-w-3xl rounded-lg border border-border bg-background p-4 sm:p-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const useAccount = () => useQuery({ queryKey: ["platform", "account"], queryFn: () => client.account.get() });

function ProfileTab() {
  const qc = useQueryClient();
  const account = useAccount();
  const [draft, setDraft] = useState<{ name?: string; jobTitle?: string; phone?: string }>({});
  const a = account.data;
  const save = useMutation({
    mutationFn: () =>
      client.account.update({
        ...(draft.name !== undefined ? { name: draft.name.trim() } : {}),
        ...(draft.jobTitle !== undefined ? { jobTitle: draft.jobTitle.trim() || null } : {}),
        ...(draft.phone !== undefined ? { phone: draft.phone.trim() || null } : {}),
      }),
    onSuccess: async () => {
      toast.success("Profile saved");
      setDraft({});
      await qc.invalidateQueries({ queryKey: ["platform", "account"] });
    },
    onError: (err) => toast.error(messageOf(err, "Could not save")),
  });
  if (!a) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const name = draft.name ?? a.name;
  return (
    <Section title="Your details" description="Your email is your sign-in and your role is set by an owner under Staff, so both are read-only here.">
      <form
        className="grid gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="flex items-center gap-3">
          <Avatar className="border border-border bg-muted">
            <AvatarFallback className="bg-muted font-semibold">{(name || a.email).slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{name || a.email}</p>
            <p className="truncate text-muted-foreground">{a.email}</p>
          </div>
          <Badge variant="secondary" className="ml-auto">{a.roleLabel}</Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="pa-name">Name</FieldLabel>
            <Input id="pa-name" value={name} maxLength={120} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pa-title">Job title</FieldLabel>
            <Input id="pa-title" value={draft.jobTitle ?? a.jobTitle ?? ""} maxLength={80} onChange={(e) => setDraft({ ...draft, jobTitle: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pa-email">Work email</FieldLabel>
            <Input id="pa-email" value={a.email} readOnly disabled />
          </Field>
          <Field>
            <FieldLabel htmlFor="pa-phone">Phone</FieldLabel>
            <Input id="pa-phone" value={draft.phone ?? a.phone ?? ""} inputMode="tel" onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending} disabled={Object.keys(draft).length === 0 || !name.trim()}>
            Save changes
          </Button>
        </div>
      </form>
    </Section>
  );
}

function SecurityTab() {
  return (
    <div className="grid gap-4">
      <PasswordSection />
      <MfaSection />
      <SessionsSection />
      <SecurityActivitySection />
    </div>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 10) return setError("New password must be at least 10 characters.");
    if (next !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    setError(null);
    const res = await changePassword(current, next);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    toast.success("Password changed. Other devices were signed out.");
    setCurrent("");
    setNext("");
    setConfirm("");
  }
  return (
    <Section title="Password" description="At least 10 characters. Changing it signs you out everywhere else.">
      <form onSubmit={submit} className="grid max-w-md gap-3">
        <Field>
          <FieldLabel htmlFor="pw-cur">Current password</FieldLabel>
          <PasswordInput id="pw-cur" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="pw-new">New password</FieldLabel>
          <PasswordInput id="pw-new" autoComplete="new-password" required minLength={10} maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="pw-conf">Confirm new password</FieldLabel>
          <PasswordInput id="pw-conf" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <div>
          <Button type="submit" loading={busy} disabled={!current || !next || !confirm}>
            Update password
          </Button>
        </div>
      </form>
    </Section>
  );
}

function MfaSection() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const regen = useMutation({
    mutationFn: async () => {
      const res = await regenerateBackupCodes(password);
      if (!res.ok) throw new Error(res.message);
      return res.codes;
    },
    onSuccess: (c) => {
      setOpen(false);
      setPassword("");
      setCodes(c);
    },
    onError: (err) => toast.error(messageOf(err, "Could not make new codes")),
  });
  const mfa = account.data?.mfa;
  return (
    <Section title="Two-step verification" description="Required for all platform staff. Your authenticator app is asked for a code at every sign-in.">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={mfa?.enabled ? "secondary" : "outline"}>
          <ShieldCheck className="mr-1 size-3" />
          {mfa?.enabled ? "On" : "Not set up"}
        </Badge>
        {mfa?.enrolledAt ? <span className="text-xs text-muted-foreground">Set up {when(mfa.enrolledAt)}</span> : null}
        {mfa?.enabled ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Make new backup codes
          </Button>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">It cannot be turned off for platform staff. If you lose your phone, use a backup code, then ask an owner for help.</p>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setPassword("");
        }}
        title="Make new backup codes?"
        description="Your current backup codes stop working as soon as new ones are made."
        confirmLabel="Make new codes"
        pending={regen.isPending}
        confirmDisabled={!password}
        onConfirm={() => regen.mutate()}
      >
        <Field>
          <FieldLabel htmlFor="mfa-regen-pw">Password</FieldLabel>
          <PasswordInput id="mfa-regen-pw" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <Dialog open={codes !== null} onOpenChange={(o) => (!o ? setCodes(null) : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your new backup codes</DialogTitle>
            <DialogDescription>Each code works once. They are shown only now, so store them somewhere safe.</DialogDescription>
          </DialogHeader>
          <ul className="grid grid-cols-2 gap-1.5 rounded-md bg-muted p-3 font-mono text-sm">
            {(codes ?? []).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => void navigator.clipboard?.writeText((codes ?? []).join("\n")).then(() => toast.success("Codes copied"))}>
              <Copy className="mr-2 size-3.5" />
              Copy codes
            </Button>
            <Button onClick={() => setCodes(null)}>I have saved them</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function SessionsSection() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["platform", "account", "sessions"], queryFn: () => client.account.sessions() });
  const [confirmAll, setConfirmAll] = useState(false);
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["platform", "account", "sessions"] }), qc.invalidateQueries({ queryKey: ["platform", "account", "events"] }), qc.invalidateQueries({ queryKey: ["platform", "account", "activity"] })]);
  const revoke = useMutation({
    mutationFn: (id: string) => client.account.revokeSession({ id }),
    onSuccess: async () => {
      toast.success("Device signed out");
      await refresh();
    },
    onError: (err) => toast.error(messageOf(err, "Could not sign that device out")),
  });
  const revokeAll = useMutation({
    mutationFn: () => client.account.revokeOtherSessions(),
    onSuccess: async (r) => {
      toast.success(r.count ? `Signed out ${r.count} other ${r.count === 1 ? "device" : "devices"}` : "No other devices were signed in");
      setConfirmAll(false);
      await refresh();
    },
    onError: (err) => toast.error(messageOf(err, "Could not sign the other devices out")),
  });
  const list = sessions.data ?? [];
  return (
    <Section title="Where you are signed in" description="Sign out any device you do not recognise. Sessions last 7 days.">
      <ul className="divide-y divide-border">
        {list.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 text-sm">
              <p className="flex items-center gap-2 font-medium">
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
      {list.some((s) => !s.current) ? (
        <Button className="mt-3" size="sm" variant="outline" onClick={() => setConfirmAll(true)}>
          Sign out all other devices
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out all other devices?"
        description="You stay signed in here. Every other device will need your password and a code again."
        confirmLabel="Sign them out"
        destructive
        pending={revokeAll.isPending}
        onConfirm={() => revokeAll.mutate()}
      />
    </Section>
  );
}

function SecurityActivitySection() {
  const events = useQuery({ queryKey: ["platform", "account", "events"], queryFn: () => client.account.securityEvents() });
  const list = events.data ?? [];
  return (
    <Section title="Recent security activity" description="Sign-ins and changes to your password, authenticator and devices.">
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm first:pt-0 last:pb-0">
              <span className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</span>
              <span className="text-xs text-muted-foreground">
                {e.device}
                {e.ip ? ` · ${e.ip}` : ""} · {when(e.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function AccessTab() {
  const account = useAccount();
  const a = account.data;
  if (!a) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="grid gap-4">
      <Section title="How you are acting right now" description="Normal platform staff work is audited under your name. A support session is a separate, time-limited way into one store.">
        {a.supportSessions.length === 0 ? (
          <p className="text-sm">You are acting as <strong>normal platform staff</strong>. No support session is open.</p>
        ) : (
          <ul className="grid gap-2">
            {a.supportSessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-3 text-sm">
                <Headphones className="size-4" />
                <span className="font-medium">Support session in {s.storeName}</span>
                <Badge variant="outline">{s.scope.replace("_", " ")}</Badge>
                <span className="text-xs text-muted-foreground">ends {when(s.expiresAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={`Your role: ${a.roleLabel}`} description="Set by an owner under Staff. You can see it here but not change it. The server enforces these limits on every action.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Can</p>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {a.can.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cannot</p>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {a.cannot.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Need a different role? Ask a platform owner.</p>
      </Section>
    </div>
  );
}

function ActivityTab() {
  const activity = useQuery({ queryKey: ["platform", "account", "activity"], queryFn: () => client.account.activity() });
  const list = activity.data ?? [];
  return (
    <Section title="Your recent actions" description="The latest privileged actions recorded under your name. The full trail is in Audit log.">
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No actions recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm first:pt-0 last:pb-0">
              <span className="font-medium capitalize">{actionLabel(r.action)}</span>
              <span className="text-xs text-muted-foreground">
                {r.targetType} · {when(r.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
