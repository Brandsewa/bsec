import * as React from "react";
import { Bell, CheckCheck, Settings, Trash2 } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "../lib/cn";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";

/**
 * The in-app notification drawer shared by the store admin and Super Admin (docs/NOTIFICATION-MANAGER-PLAN.md section 6b).
 * Presentation only: the apps pass the tabs and handle the actions, so this file knows nothing about the API.
 */

export interface NotificationDrawerItem {
  id: string;
  title: string;
  body?: string | undefined;
  link?: string | null | undefined;
  read: boolean;
  createdAt: string;
}

export interface NotificationDrawerTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  items: NotificationDrawerItem[];
  /** Unread count shown on the tab. */
  unread: number;
  /** A read-only feed (such as Activity) has no unread dots and is not cleared by Mark all read. */
  feed?: boolean | undefined;
  emptyText?: string | undefined;
}

export interface NotificationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  tabs: NotificationDrawerTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  onItemClick: (item: NotificationDrawerItem, tabId: string) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onOpenSettings?: (() => void) | undefined;
  loading?: boolean;
}

function ago(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (Date.now() - d.getTime() < 60_000) return "just now";
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function NotificationDrawer({ open, onOpenChange, title = "Notifications", tabs, activeTab, onTabChange, onItemClick, onMarkAllRead, onClearAll, onOpenSettings, loading }: NotificationDrawerProps) {
  const total = tabs.filter((t) => !t.feed).reduce((n, t) => n + t.unread, 0);
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:w-[40vw] sm:min-w-[380px] sm:max-w-[520px]">
        <SheetHeader className="gap-0 border-b border-border p-4">
          <div className="flex items-center gap-2 pr-8">
            <Bell className="size-4 text-primary" aria-hidden />
            <SheetTitle className="text-base">{title}</SheetTitle>
            {total > 0 ? <Badge variant="secondary">{total} unread</Badge> : null}
            {onOpenSettings ? (
              <button type="button" onClick={onOpenSettings} className="ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Notification settings">
                <Settings className="size-4" />
              </button>
            ) : null}
          </div>
          <SheetDescription className="sr-only">Your recent notifications, grouped by tab.</SheetDescription>
        </SheetHeader>

        <div role="tablist" aria-label="Notification groups" className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === active?.id}
              onClick={() => onTabChange(t.id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                t.id === active?.id ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t.icon}
              {t.label}
              <span className="text-xs text-muted-foreground">({t.feed ? t.items.length : t.unread})</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3" role="tabpanel">
          {loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : !active || active.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <Bell className="size-6 opacity-40" aria-hidden />
              {active?.emptyText ?? "You are all caught up."}
            </div>
          ) : (
            <ul className="grid gap-2">
              {active.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onItemClick(item, active.id)}
                    className={cn(
                      "w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted/60",
                      !item.read && !active.feed && "border-primary/40 bg-primary/5",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        {!item.read && !active.feed ? <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
                        <span className="truncate">{item.title}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{ago(item.createdAt)}</span>
                    </div>
                    {item.body ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.body}</p> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
          <Button variant="outline" onClick={onMarkAllRead} disabled={total === 0}>
            <CheckCheck className="size-4" aria-hidden /> Mark all read
          </Button>
          <Button variant="outline" onClick={onClearAll} disabled={!active || active.feed === true || active.items.length === 0}>
            <Trash2 className="size-4" aria-hidden /> Clear all
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export interface NotificationBellProps {
  count: number;
  onClick: () => void;
  className?: string;
}

/** The header button that opens the drawer. */
export function NotificationBell({ count, onClick, className }: NotificationBellProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
      className={cn("relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
    >
      <Bell className="size-5" aria-hidden />
      {count > 0 ? (
        <span className="absolute right-1 top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">{count > 99 ? "99+" : count}</span>
      ) : null}
    </button>
  );
}
