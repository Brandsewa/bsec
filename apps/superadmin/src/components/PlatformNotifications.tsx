import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Building2, CreditCard, Server } from "lucide-react";
import { NotificationBell, NotificationDrawer, type NotificationDrawerTab } from "@bs/ui";
import { client } from "../lib/orpc.ts";

const TABS = [
  { id: "stores", label: "Stores", icon: <Building2 className="size-3.5" aria-hidden />, empty: "No new store activity." },
  { id: "billing", label: "Billing", icon: <CreditCard className="size-3.5" aria-hidden />, empty: "No billing alerts." },
  { id: "system", label: "System", icon: <Server className="size-3.5" aria-hidden />, empty: "No system alerts." },
] as const;

/** The Super Admin bell and drawer. Polls the inbox while the tab is visible (plan section 6b: polling first). */
export function PlatformNotifications() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string>("stores");
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["platform", "notifications", "inbox"],
    queryFn: () => client.notifications.inbox(),
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["platform", "notifications", "inbox"] });
  const tabs: NotificationDrawerTab[] = TABS.map((t) => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
    emptyText: t.empty,
    unread: data?.unread[t.id] ?? 0,
    items: (data?.items ?? []).filter((i) => i.tab === t.id).map((i) => ({ id: i.id, title: i.title, body: i.body, link: i.link, read: i.read, createdAt: i.createdAt })),
  }));

  return (
    <>
      <NotificationBell count={data?.unreadTotal ?? 0} onClick={() => setOpen(true)} />
      <NotificationDrawer
        open={open}
        onOpenChange={setOpen}
        tabs={tabs}
        activeTab={tab}
        onTabChange={setTab}
        loading={isLoading}
        onOpenSettings={() => {
          setOpen(false);
          router.history.push("/notifications");
        }}
        onItemClick={async (item) => {
          if (!item.read) await client.notifications.markInbox({ ids: [item.id] }).then(refresh);
          if (item.link) {
            setOpen(false);
            router.history.push(item.link);
          }
        }}
        onMarkAllRead={async () => {
          await client.notifications.markInbox({ all: true });
          await refresh();
        }}
        onClearAll={async () => {
          const ids = tabs.find((t) => t.id === tab)?.items.map((i) => i.id) ?? [];
          if (ids.length > 0) await client.notifications.markInbox({ ids: ids.slice(0, 100), clear: true });
          await refresh();
        }}
      />
    </>
  );
}
