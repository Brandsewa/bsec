import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  EmailBrandingEditor,
  Label,
  PageContainer,
  PageHeader,
  PageSkeleton,
  ScrollTabs,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
  type EmailBrandingValue,
} from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";
import { useHasRole } from "../lib/user-context.tsx";

type Channel = "in_app" | "email" | "sms" | "whatsapp";
type MatrixEvent = Awaited<ReturnType<typeof client.notifications.matrix>>["events"][number];

const CHANNELS: Array<{ id: Channel; label: string }> = [
  { id: "in_app", label: "In-app" },
  { id: "email", label: "Email" },
  { id: "sms", label: "SMS" },
  { id: "whatsapp", label: "WhatsApp" },
];

const AUDIENCES: Array<{ id: MatrixEvent["audience"]; label: string; note: string }> = [
  { id: "platform", label: "Super Admin", note: "Alerts for our own team." },
  { id: "store", label: "Store admin", note: "Sent to a store's owner and admins." },
  { id: "customer", label: "Customer", note: "Sent by a store to its shoppers. Stores can switch these off unless locked." },
];

const ROLE_LABEL: Record<string, string> = { platform_owner: "Owner", platform_admin: "Admin", platform_support: "Support" };

export function NotificationManager() {
  const [view, setView] = useState<"events" | "branding">("events");
  return (
    <PageContainer>
      <PageHeader title="Notifications" description="Choose which events notify whom, and how the emails look. SMS and WhatsApp switch on once the provider is connected." />
      <ScrollTabs
        value={view}
        onChange={(v) => setView(v as "events" | "branding")}
        tabs={[
          { id: "events", label: "Events" },
          { id: "branding", label: "Email branding" },
        ]}
      />
      <div className="mt-4">{view === "events" ? <EventsMatrix /> : <PlatformBranding />}</div>
    </PageContainer>
  );
}

function EventsMatrix() {
  const canManage = useHasRole("platform_admin");
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MatrixEvent | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["platform", "notifications", "matrix"], queryFn: () => client.notifications.matrix() });

  const toggle = useMutation({
    mutationFn: (v: { eventKey: string; channel: Channel; enabled: boolean }) => client.notifications.updateRule(v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform", "notifications", "matrix"] }),
    onError: (err) => toast.error(messageOf(err, "Could not update the rule")),
  });

  if (isLoading || !data) return <PageSkeleton />;
  return (
    <div className="grid gap-6">
      {AUDIENCES.map((aud) => {
        const events = data.events.filter((e) => e.audience === aud.id);
        if (events.length === 0) return null;
        return (
          <section key={aud.id} aria-labelledby={`aud-${aud.id}`} className="rounded-lg border border-border bg-card">
            <div className="border-b border-border p-4">
              <h2 id={`aud-${aud.id}`} className="text-sm font-semibold">{aud.label}</h2>
              <p className="text-xs text-muted-foreground">{aud.note}</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  {CHANNELS.map((c) => (
                    <TableHead key={c.id} className="w-24 text-center">{c.label}</TableHead>
                  ))}
                  {aud.id === "platform" || aud.id === "store" ? <TableHead className="w-28 text-right">Recipients</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.key}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {e.label}
                        {e.locked ? <Lock className="size-3.5 text-muted-foreground" aria-label="Locked: required, only Super Admin can change it" /> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{e.category} · {e.description}</p>
                    </TableCell>
                    {CHANNELS.map((c) => {
                      const cell = e.channels[c.id];
                      if (!cell.offered) return <TableCell key={c.id} className="text-center text-muted-foreground">·</TableCell>;
                      if (!cell.connected) {
                        return (
                          <TableCell key={c.id} className="text-center">
                            <Badge variant="outline" className="text-[10px]">Not connected</Badge>
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell key={c.id} className="text-center">
                          <Switch
                            aria-label={`${e.label}: ${c.label}`}
                            checked={cell.enabled}
                            disabled={!canManage || toggle.isPending || (e.locked && c.id === "email" && e.audience === "customer")}
                            onCheckedChange={(checked) => toggle.mutate({ eventKey: e.key, channel: c.id, enabled: checked })}
                          />
                        </TableCell>
                      );
                    })}
                    {aud.id === "platform" || aud.id === "store" ? (
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => setEditing(e)}>Edit</Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        );
      })}
      <p className="text-xs text-muted-foreground">In-app notifications are kept for {data.retentionDays} days. Security emails are locked.</p>
      {editing ? <RecipientsSheet key={editing.key} event={editing} roles={data.roles} canManage={canManage} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function RecipientsSheet({ event, roles, canManage, onClose }: { event: MatrixEvent; roles: string[]; canManage: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>(event.roleRecipients);
  const [emails, setEmails] = useState(event.extraEmails.join("\n"));
  const isPlatform = event.audience === "platform";
  const save = useMutation({
    mutationFn: async () => {
      const extraEmails = emails.split(/[\s,;]+/).filter(Boolean);
      const channel: Channel = event.channels.email.offered ? "email" : "in_app";
      await client.notifications.updateRule({ eventKey: event.key, channel, ...(isPlatform ? { roleRecipients: selected } : {}), extraEmails });
    },
    onSuccess: async () => {
      toast.success("Recipients saved");
      await qc.invalidateQueries({ queryKey: ["platform", "notifications", "matrix"] });
      onClose();
    },
    onError: (err) => toast.error(messageOf(err, "Could not save recipients")),
  });
  return (
    <Sheet open onOpenChange={(o) => (o ? undefined : onClose())}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:w-[40vw] sm:min-w-[380px] sm:max-w-[520px]">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle>{event.label}</SheetTitle>
          <SheetDescription>{event.description}</SheetDescription>
        </SheetHeader>
        <div className="grid flex-1 content-start gap-5 overflow-y-auto p-4">
          {isPlatform ? (
            <div className="grid gap-2">
              <Label>Staff roles that receive this</Label>
              {roles.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selected.includes(r)} disabled={!canManage} onCheckedChange={(c) => setSelected((cur) => (c ? [...new Set([...cur, r])] : cur.filter((x) => x !== r)))} />
                  {ROLE_LABEL[r] ?? r}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">Everyone active with a ticked role gets the in-app card and the email.</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Store events go to each store's owner and admins. Stores add their own extra addresses; add platform-wide copies below.</p>
          )}
          <div className="grid gap-2">
            <Label htmlFor="extra-emails">Also email these addresses (up to 5)</Label>
            <Textarea id="extra-emails" rows={4} value={emails} disabled={!canManage} onChange={(e) => setEmails(e.target.value)} placeholder="ops@example.com" />
            <p className="text-xs text-muted-foreground">One per line. These get the email only, never an in-app card.</p>
          </div>
        </div>
        <SheetFooter className="border-t border-border p-3">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!canManage || save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function PlatformBranding() {
  const canManage = useHasRole("platform_admin");
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["platform", "notifications", "branding"], queryFn: () => client.notifications.branding() });
  const [value, setValue] = useState<EmailBrandingValue | null>(null);
  const [html, setHtml] = useState("");
  const [issues, setIssues] = useState<Array<{ field: string; message: string }>>([]);
  const seeded = useRef(false);

  useEffect(() => {
    if (data && !seeded.current) {
      seeded.current = true;
      setValue(data.tokens);
    }
  }, [data]);

  // Debounced live preview: the server renders the same layout real emails use.
  useEffect(() => {
    if (!value) return;
    const t = setTimeout(() => {
      client.notifications.previewBranding({ ...value }).then((r) => {
        setHtml(r.html);
        setIssues(r.issues);
      }).catch(() => undefined);
    }, 350);
    return () => clearTimeout(t);
  }, [value]);

  const save = useMutation({
    mutationFn: (v: EmailBrandingValue) => client.notifications.updateBranding({ ...v }),
    onSuccess: async (r) => {
      setIssues(r.issues);
      toast.success(r.issues.length > 0 ? "Saved; some values were adjusted" : "Email branding saved");
      await qc.invalidateQueries({ queryKey: ["platform", "notifications", "branding"] });
    },
    onError: (err) => toast.error(messageOf(err, "Could not save branding")),
  });
  const dirty = useMemo(() => JSON.stringify(value) !== JSON.stringify(data?.tokens), [value, data]);

  if (isLoading || !value) return <PageSkeleton />;
  return (
    <EmailBrandingEditor
      value={value}
      onChange={canManage ? setValue : () => undefined}
      previewHtml={html}
      issues={issues}
      showTypography
      dirty={dirty && canManage}
      saving={save.isPending}
      onSave={() => save.mutate(value)}
      audienceNote="These colours, fonts and the footer style every email we send to store admins and our own staff: billing, trial and account messages, and Super Admin alerts. Stores style their own customer emails separately."
    />
  );
}
