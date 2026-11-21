import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Avatar, AvatarFallback, Badge, Button, Field, FieldDescription, FieldGroup, FieldLabel, FormSkeleton, Input, SimpleSelect, Switch, toast } from "@bs/ui";
import { AccountCard } from "./account-card.tsx";
import { client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

type Profile = Awaited<ReturnType<typeof client.admin.account.get>>;

const DEFAULT = "__default";

function timezones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = fn ? fn("timeZone") : [];
  return list.length ? list : ["Asia/Kolkata", "UTC", "America/New_York", "Europe/London", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];
}

const DATE_OPTIONS = [
  { value: DEFAULT, label: "Store default" },
  { value: "dd/mm/yyyy", label: "31/12/2026 (day first)" },
  { value: "mm/dd/yyyy", label: "12/31/2026 (month first)" },
  { value: "yyyy-mm-dd", label: "2026-12-31 (year first)" },
];
const TIME_OPTIONS = [
  { value: DEFAULT, label: "Store default" },
  { value: "12h", label: "12 hour (3:30 PM)" },
  { value: "24h", label: "24 hour (15:30)" },
];
const LANDING_OPTIONS = [
  { value: DEFAULT, label: "Dashboard" },
  { value: "orders", label: "Orders" },
  { value: "products", label: "Products" },
  { value: "analytics", label: "Analytics" },
];
const DENSITY_OPTIONS = [
  { value: DEFAULT, label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

const orNull = (v: string) => (v === DEFAULT ? null : v);

export function ProfileTab() {
  const profile = useQuery({ queryKey: ["admin", "account"], queryFn: () => client.admin.account.get() });
  if (profile.isLoading || !profile.data) {
    return (
      <AccountCard>
        <FormSkeleton />
      </AccountCard>
    );
  }
  return (
    <div className="grid gap-4">
      <ProfileForm profile={profile.data} />
      <AlertsCard />
      <AccessCard profile={profile.data} />
    </div>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const [name, setName] = useState(profile.name);
  const [jobTitle, setJobTitle] = useState(profile.jobTitle ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [timezone, setTimezone] = useState(profile.timezone ?? DEFAULT);
  const [dateFormat, setDateFormat] = useState(profile.dateFormat ?? DEFAULT);
  const [timeFormat, setTimeFormat] = useState(profile.timeFormat ?? DEFAULT);
  const [landing, setLanding] = useState(profile.defaultLanding ?? DEFAULT);
  const [density, setDensity] = useState(profile.uiDensity ?? DEFAULT);
  const zones = useMemo(() => [{ value: DEFAULT, label: "Browser timezone" }, ...timezones().map((z) => ({ value: z, label: z.replaceAll("_", " ") }))], []);

  const save = useMutation({
    mutationFn: () =>
      client.admin.account.update({
        name: name.trim(),
        jobTitle: jobTitle.trim() || null,
        phone: phone.trim() || null,
        timezone: orNull(timezone),
        dateFormat: orNull(dateFormat) as "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | null,
        timeFormat: orNull(timeFormat) as "12h" | "24h" | null,
        defaultLanding: orNull(landing) as "orders" | "products" | "analytics" | "dashboard" | null,
        uiDensity: orNull(density) as "compact" | "comfortable" | null,
      }),
    onSuccess: async () => {
      toast.success("Profile saved");
      await Promise.all([qc.invalidateQueries({ queryKey: ["admin", "account"] }), qc.invalidateQueries({ queryKey: ["me"] })]);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <AccountCard title="Your details" description="How you appear to your team and how the admin is set up for you.">
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="flex items-center gap-3">
          <Avatar size="lg" className="border border-border-soft bg-muted">
            <AvatarFallback className="bg-muted font-semibold text-foreground">{(name || profile.email).slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium text-foreground">{name || profile.email}</p>
            <p className="truncate text-muted-foreground">{profile.email}</p>
          </div>
        </div>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="acct-name">Name</FieldLabel>
              <Input id="acct-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoComplete="name" />
            </Field>
            <Field>
              <FieldLabel htmlFor="acct-title">Job title</FieldLabel>
              <Input id="acct-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={80} placeholder="Operations lead" />
            </Field>
            <Field>
              <FieldLabel htmlFor="acct-email">Email</FieldLabel>
              <Input id="acct-email" value={profile.email} readOnly disabled />
              <FieldDescription>This is your sign-in. Ask the store owner if it needs to change.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="acct-phone">Phone</FieldLabel>
              <Input id="acct-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="acct-tz">Timezone</FieldLabel>
              <SimpleSelect id="acct-tz" value={timezone} onChange={setTimezone} options={zones} ariaLabel="Timezone" />
            </Field>
            <Field>
              <FieldLabel htmlFor="acct-landing">Open the admin on</FieldLabel>
              <SimpleSelect id="acct-landing" value={landing} onChange={setLanding} options={LANDING_OPTIONS} ariaLabel="Default landing page" />
            </Field>
            <Field>
              <FieldLabel htmlFor="acct-date">Date format</FieldLabel>
              <SimpleSelect id="acct-date" value={dateFormat} onChange={setDateFormat} options={DATE_OPTIONS} ariaLabel="Date format" />
            </Field>
            <Field>
              <FieldLabel htmlFor="acct-time">Time format</FieldLabel>
              <SimpleSelect id="acct-time" value={timeFormat} onChange={setTimeFormat} options={TIME_OPTIONS} ariaLabel="Time format" />
            </Field>
            <Field>
              <FieldLabel htmlFor="acct-density">Table density</FieldLabel>
              <SimpleSelect id="acct-density" value={density} onChange={setDensity} options={DENSITY_OPTIONS} ariaLabel="Table density" />
            </Field>
            <Field>
              <FieldLabel>Language</FieldLabel>
              <Input value="English" readOnly disabled />
            </Field>
          </div>
        </FieldGroup>
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending} disabled={!name.trim()}>
            Save changes
          </Button>
        </div>
      </form>
    </AccountCard>
  );
}

function AlertsCard() {
  const qc = useQueryClient();
  const alerts = useQuery({ queryKey: ["admin", "account", "alerts"], queryFn: () => client.admin.account.alerts() });
  const toggle = useMutation({
    mutationFn: (v: { key: string; muted: boolean }) => client.admin.account.setAlertMuted(v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "account", "alerts"] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <AccountCard title="Alerts for you" description="Switch off an alert you do not want. The store decides who can receive an alert; this only mutes it for you.">
      {alerts.isLoading ? (
        <FormSkeleton />
      ) : (
        <ul className="divide-y divide-border-soft">
          {(alerts.data ?? []).map((a) => (
            <li key={a.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {a.label}
                  {a.locked ? (
                    <Badge variant="outline">
                      <Lock className="mr-1 size-3" />
                      Always on
                    </Badge>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">{a.description}</p>
              </div>
              <Switch aria-label={a.label} checked={!a.muted} disabled={a.locked || toggle.isPending} onCheckedChange={(on) => toggle.mutate({ key: a.key, muted: !on })} />
            </li>
          ))}
        </ul>
      )}
    </AccountCard>
  );
}

function AccessCard({ profile }: { profile: Profile }) {
  return (
    <AccountCard title="Your access" description="Set by the store owner under Settings, Users. You can see it here but not change it.">
      {profile.access.length === 0 ? (
        <p className="text-sm text-muted-foreground">You are not a member of any store.</p>
      ) : (
        <ul className="grid gap-4">
          {profile.access.map((a) => (
            <li key={a.tenantId} className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-foreground">{a.storeName}</span>
                <Badge variant="secondary">{a.role.replaceAll("_", " ")}</Badge>
                {a.joinedAt ? (
                  <span className="text-xs text-muted-foreground">
                    Joined {new Date(a.joinedAt).toLocaleDateString()}
                    {a.invitedBy ? ` · invited by ${a.invitedBy}` : ""}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1">
                {a.permissions.map((p) => (
                  <Badge key={p} variant="outline" className="font-mono text-[10px]">
                    {p}
                  </Badge>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Need more access? Ask the store owner to change your role.</p>
    </AccountCard>
  );
}
