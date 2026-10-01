import { Outlet, createFileRoute, redirect, useRouterState } from "@tanstack/react-router";
import {
  BadgePercent,
  FileText,
  Home,
  Menu,
  Package,
  Palette,
  RotateCcw,
  Settings,
  ShoppingBag,
  Users,
  Warehouse,
} from "lucide-react";
import { EmptyState, PageContainer, PageSkeleton, type NavGroup } from "@bs/ui";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { fetchMe, signOut } from "../lib/auth.ts";
import { getActiveStoreId, setActiveStoreId } from "../lib/session.ts";
import { clearSupportSession } from "../lib/support.ts";

interface GatedItem {
  label: string;
  href: string;
  icon: NonNullable<NavGroup["items"][number]["icon"]>;
  /** Permission the store role must hold to see the item; omitted means everyone signed in. */
  perm?: string;
}
interface GatedGroup {
  label?: string;
  items: GatedItem[];
}

const nav: GatedGroup[] = [
  { items: [{ label: "Home", href: "/", icon: Home }] },
  {
    label: "Sell",
    items: [
      { label: "Orders", href: "/orders", icon: ShoppingBag, perm: "orders.read" },
      { label: "Returns", href: "/returns", icon: RotateCcw, perm: "orders.read" },
      { label: "Products", href: "/products", icon: Package, perm: "products.read" },
      { label: "Inventory", href: "/inventory", icon: Warehouse, perm: "products.read" },
      { label: "Customers", href: "/customers", icon: Users, perm: "customers.read" },
      { label: "Discounts", href: "/discounts", icon: BadgePercent, perm: "discounts.write" },
    ],
  },
  {
    label: "Online Store",
    items: [
      { label: "Themes", href: "/online-store/theme-library", icon: Palette, perm: "theme.publish" },
      { label: "Pages", href: "/online-store/pages", icon: FileText, perm: "content.write" },
      { label: "Navigation", href: "/online-store/menus", icon: Menu, perm: "content.write" },
    ],
  },
  {
    // One entry: the Settings workspace has its own section navigation.
    label: "Settings",
    items: [{ label: "Settings", href: "/settings", icon: Settings, perm: "settings.write" }],
  },
];

function visibleNav(permissions: readonly string[]): NavGroup[] {
  return nav
    .map((g) => ({
      ...(g.label ? { label: g.label } : {}),
      items: g.items.filter((i) => !i.perm || permissions.includes(i.perm)).map(({ label, href, icon }) => ({ label, href, icon })),
    }))
    .filter((g) => g.items.length > 0);
}

export const Route = createFileRoute("/_store")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 60_000 });
    if (!me) throw redirect({ to: "/login" });
    const saved = getActiveStoreId();
    const store = me.stores.find((s) => s.tenantId === saved) ?? me.stores[0] ?? null;
    // A support session never overwrites the store the signed-in user last chose.
    if (store && !me.support) setActiveStoreId(store.tenantId);
    return { me, store };
  },
  pendingComponent: () => <PageSkeleton />,
  component: StoreShell,
});

function StoreShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { me, store } = Route.useRouteContext();

  async function onSignOut() {
    if (me.support) {
      clearSupportSession();
    } else {
      await signOut();
    }
    window.location.assign("/login");
  }

  if (!store) {
    return (
      <PageContainer size="small">
        <EmptyState
          title="No store access"
          description={`${me.user.email} is not a member of any store. Ask a store owner to invite you.`}
          action={<Button onClick={onSignOut}>Sign out</Button>}
        />
      </PageContainer>
    );
  }

  return (
    <AppShell
      brand={<span className="text-sm font-semibold">{store.name}</span>}
      groups={visibleNav(store.permissions)}
      activeHref={pathname}
      banner={
        me.support ? (
          <div
            role="alert"
            data-testid="support-banner"
            className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-black"
          >
            <span>
              PLATFORM SUPPORT SESSION · {me.support.scope === "write" ? "read & WRITE access" : "read-only"} · ticket {me.support.ticketRef} · ends{" "}
              {new Date(me.support.expiresAt).toLocaleTimeString()} · everything you do here is recorded
            </span>
            <Button size="sm" variant="outline" onClick={onSignOut}>
              Leave support mode
            </Button>
          </div>
        ) : undefined
      }
      topRight={
        <>
          {me.stores.length > 1 ? (
            <select
              aria-label="Switch store"
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              value={store.tenantId}
              onChange={(e) => {
                setActiveStoreId(e.target.value);
                window.location.assign("/");
              }}
            >
              {me.stores.map((s) => (
                <option key={s.tenantId} value={s.tenantId}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}
          <span className="hidden text-sm text-foreground-lighter sm:inline">{me.support ? `Support: ${me.user.email}` : me.user.email}</span>
          {me.support ? null : (
            <Button variant="ghost" size="sm" onClick={onSignOut}>
              Sign out
            </Button>
          )}
        </>
      }
    >
      <Outlet />
    </AppShell>
  );
}
