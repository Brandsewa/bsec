import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { History, Server, ShoppingBag } from "lucide-react";
import { NotificationBell, NotificationDrawer, type NotificationDrawerTab } from "@bs/ui";
import { client } from "../../lib/orpc.ts";

/**
 * The store admin bell and drawer (docs/NOTIFICATION-MANAGER-PLAN.md section 6b): Orders, Activity (the staff audit
 * feed) and System (billing, plan and platform messages). Polls while the page is visible.
 */
export function StoreNotifications({ canSeeActivity }: { canSeeActivity: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("orders");
  const router = useRouter();
  const qc = useQueryClient();
  const inbox = useQuery({ queryKey: ["admin", "notifications", "inbox"], queryFn: () => client.admin.notifications.inbox(), refetchInterval: 45_000, refetchIntervalInBackground: false });
  const activity = useQuery({ queryKey: ["admin", "notifications", "activity"], queryFn: () => client.admin.notifications.activity(), enabled: open && canSeeActivity });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "notifications", "inbox"] });
  const fromInbox = (id: "orders" | "system") =>
    (inbox.data?.items ?? []).filter((i) => i.tab === id).map((i) => ({ id: i.id, title: i.title, body: i.body, link: i.link, read: i.read, createdAt: i.createdAt }));

  const tabs: NotificationDrawerTab[] = [
    { id: "orders", label: "Orders", icon: <ShoppingBag className="size-3.5" aria-hidden />, unread: inbox.data?.unread.orders ?? 0, items: fromInbox("orders"), emptyText: "No new orders yet." },
    ...(canSeeActivity
      ? [
          {
            id: "activity",
            label: "Activity",
            icon: <History className="size-3.5" aria-hidden />,
            feed: true,
            unread: 0,
            emptyText: "No recent changes.",
            items: (activity.data ?? []).map((a) => ({ id: a.id, title: a.action.replaceAll("_", " ").replaceAll(".", " · "), body: a.target, link: null, read: true, createdAt: a.createdAt })),
          } satisfies NotificationDrawerTab,
        ]
      : []),
    { id: "system", label: "System", icon: <Server className="size-3.5" aria-hidden />, unread: inbox.data?.unread.system ?? 0, items: fromInbox("system"), emptyText: "No billing or product messages." },
  ];

  return (
    <>
      <NotificationBell count={inbox.data?.unreadTotal ?? 0} onClick={() => setOpen(true)} />
      <NotificationDrawer
        open={open}
        onOpenChange={setOpen}
        tabs={tabs}
        activeTab={tab}
        onTabChange={setTab}
        loading={inbox.isLoading}
        onOpenSettings={() => {
          setOpen(false);
          router.history.push("/settings/notification-alerts");
        }}
        onItemClick={async (item, tabId) => {
          if (tabId !== "activity" && !item.read) await client.admin.notifications.markInbox({ ids: [item.id] }).then(refresh);
          if (item.link) {
            setOpen(false);
            router.history.push(item.link);
          }
        }}
        onMarkAllRead={async () => {
          await client.admin.notifications.markInbox({ all: true });
          await refresh();
        }}
        onClearAll={async () => {
          const ids = tabs.find((t) => t.id === tab)?.items.map((i) => i.id) ?? [];
          if (ids.length > 0) await client.admin.notifications.markInbox({ ids: ids.slice(0, 100), clear: true });
          await refresh();
        }}
      />
    </>
  );
}
