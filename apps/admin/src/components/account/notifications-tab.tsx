import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Badge, FormSkeleton, Switch, toast } from "@bs/ui";
import { AccountCard } from "./account-card.tsx";
import { client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

export function NotificationsTab() {
  return <AlertsCard />;
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

