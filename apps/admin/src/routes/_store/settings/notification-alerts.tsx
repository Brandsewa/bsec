import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { Badge, Button, EmptyState, FormSkeleton, PageSkeleton, Switch, Textarea, toast } from "@bs/ui";
import { SettingsCard, SettingsPageFrame } from "../../../components/settings/settings-page.tsx";
import { client } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/notification-alerts")({
  pendingComponent: () => <PageSkeleton />,
  component: NotificationAlertsPage,
});

const TITLE = "Team alerts";
const DESCRIPTION = "Choose how you hear about orders and billing. The owner and admins are always notified; add more email addresses for any alert.";

type RuleEvent = Awaited<ReturnType<typeof client.admin.notifications.rules>>["events"][number];

function NotificationAlertsPage() {
  const query = useQuery({ queryKey: ["admin", "notifications", "rules"], queryFn: () => client.admin.notifications.rules() });

  if (query.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <FormSkeleton />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }
  if (query.isError || !query.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <EmptyState icon={AlertTriangle} title="Could not load your alerts" description={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>Try again</Button>} />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }
  const events = query.data.events.filter((e) => e.audience === "store");
  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {events.map((e) => (
        <AlertRow key={e.key} event={e} />
      ))}
      <p className="text-xs text-muted-foreground">Emails to your customers (order updates, shipping) are in Notifications. Wording is set by the platform; you control the logo, colours and footer in Email branding.</p>
    </SettingsPageFrame>
  );
}

function AlertRow({ event }: { event: RuleEvent }) {
  const qc = useQueryClient();
  const [emails, setEmails] = useState(event.extraEmails.join("\n"));
  const save = useMutation({
    mutationFn: (v: { channel: "in_app" | "email"; enabled?: boolean; extraEmails?: string[] }) => client.admin.notifications.updateRule({ eventKey: event.key, ...v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "notifications", "rules"] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const emailOn = event.channels.email;
  const dirty = emails.trim() !== event.extraEmails.join("\n").trim();
  return (
    <SettingsCard title={event.label} description={event.description}>
      <div className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm">
            In-app notification (the bell)
            {event.locked ? (
              <Badge variant="outline">
                <Lock className="mr-1 size-3" />
                Required
              </Badge>
            ) : null}
          </span>
          <Switch aria-label={`${event.label}: in-app`} checked={event.channels.in_app.enabled} disabled={event.locked || save.isPending} onCheckedChange={(c) => save.mutate({ channel: "in_app", enabled: c })} />
        </div>
        {emailOn.offered ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">Email to the owner and admins</span>
              <Switch aria-label={`${event.label}: email`} checked={emailOn.enabled} disabled={event.locked || save.isPending} onCheckedChange={(c) => save.mutate({ channel: "email", enabled: c })} />
            </div>
            <div className="grid gap-2">
              <label htmlFor={`extra-${event.key}`} className="text-sm font-medium">
                Also email these addresses
              </label>
              <Textarea id={`extra-${event.key}`} rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="warehouse@example.com" />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">One per line, up to 5. These people get the email only.</p>
                <Button
                  size="sm"
                  disabled={!dirty || save.isPending}
                  onClick={() => save.mutate({ channel: "email", extraEmails: emails.split(/[\s,;]+/).filter(Boolean) }, { onSuccess: () => toast.success("Addresses saved") })}
                >
                  Save addresses
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </SettingsCard>
  );
}
