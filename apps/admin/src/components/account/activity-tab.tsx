import { useQuery } from "@tanstack/react-query";
import { FieldDescription, FormSkeleton } from "@bs/ui";
import { AccountCard } from "./account-card.tsx";
import { EVENT_LABELS, when } from "./security-tab.tsx";
import { client } from "../../lib/orpc.ts";

export function ActivityTab() {
  return <ActivityCard />;
}

function ActivityCard() {
  const events = useQuery({ queryKey: ["admin", "account", "security-events"], queryFn: () => client.admin.account.securityEvents() });
  return (
    <AccountCard title="Recent security activity" description="Sign-ins and changes to your password, authenticator and devices. If something here is not you, change your password.">
      {events.isLoading ? (
        <FormSkeleton />
      ) : (events.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet. New sign-ins and security changes will appear here.</p>
      ) : (
        <ul className="divide-y divide-border-soft">
          {(events.data ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5 text-sm first:pt-0 last:pb-0">
              <span className="font-medium text-foreground">{EVENT_LABELS[e.type] ?? e.type}</span>
              <span className="text-xs text-muted-foreground">
                {e.device}
                {e.ip ? ` · ${e.ip}` : ""} · {when(e.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <FieldDescription className="mt-3">Showing the latest 30 events.</FieldDescription>
    </AccountCard>
  );
}
