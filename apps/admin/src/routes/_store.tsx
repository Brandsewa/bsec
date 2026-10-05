import { useState } from "react";
import { Outlet, createFileRoute, redirect, useRouterState } from "@tanstack/react-router";
import {
  BadgePercent,
  Banknote,
  BarChart3,
  Clock,
  FileText,
  FolderTree,
  Home,
  KeyRound,
  Layers,
  MapPin,
  Menu,
  MessageSquareQuote,
  Package,
  Palette,
  Receipt,
  RotateCcw,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Slice,
  Tag,
  Users,
  Warehouse,
} from "lucide-react";
import { EmptyState, PageContainer, PageSkeleton, ThemeToggle, type NavGroup } from "@bs/ui";
import { AppShell } from "@/components/app-shell";
import { Button } from "@bs/ui";
import { SimpleSelect } from "@bs/ui";
import { fetchMe, signOut } from "../lib/auth.ts";
import { getActiveStoreId, setActiveStoreId } from "../lib/session.ts";
import { clearSupportSession } from "../lib/support.ts";
import { ChangePasswordDialog } from "../components/settings/change-password-dialog.tsx";

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
    label: "Orders",
    items: [
      { label: "All orders", href: "/orders", icon: ShoppingBag, perm: "orders.read" },
      { label: "Pre-orders", href: "/preorders", icon: Clock, perm: "orders.read" },
      { label: "Quotes", href: "/quotes", icon: MessageSquareQuote, perm: "orders.read" },
      { label: "Abandoned checkouts", href: "/abandoned-checkouts", icon: ShoppingCart, perm: "orders.read" },
      { label: "Returns", href: "/returns", icon: RotateCcw, perm: "orders.read" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Overview", href: "/finance", icon: Banknote, perm: "finance.read" },
      { label: "Expenses", href: "/finance/expenses", icon: Receipt, perm: "finance.read" },
      { label: "Reports", href: "/finance/reports", icon: BarChart3, perm: "finance.read" },
    ],
  },
  {
    label: "Catalog",
    items: [
      { label: "Products", href: "/products", icon: Package, perm: "products.read" },
      { label: "Categories", href: "/categories", icon: FolderTree, perm: "products.read" },
      { label: "Collections", href: "/collections", icon: Layers, perm: "products.read" },
      { label: "Brands", href: "/brands", icon: Tag, perm: "products.read" },
      { label: "Locations", href: "/locations", icon: MapPin, perm: "products.read" },
      { label: "Inventory", href: "/inventory", icon: Warehouse, perm: "products.read" },
      { label: "Reviews", href: "/reviews", icon: MessageSquareQuote, perm: "products.read" },
    ],
  },
  {
    label: "Sell",
    items: [
      { label: "Customers", href: "/customers", icon: Users, perm: "customers.read" },
      { label: "Segments", href: "/segments", icon: Slice, perm: "customers.read" },
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
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

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
    <>
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
              <SimpleSelect
                ariaLabel="Switch store"
                className="h-8 w-32 sm:w-44"
                value={store.tenantId}
                onChange={(id) => {
                  setActiveStoreId(id);
                  window.location.assign("/");
                }}
                options={me.stores.map((s) => ({ value: s.tenantId, label: s.name }))}
              />
            ) : null}
            <span className="hidden text-sm text-foreground-lighter sm:inline">{me.support ? `Support: ${me.user.email}` : me.user.email}</span>
            {me.support ? null : (
              <>
                <Button variant="ghost" size="sm" onClick={() => setChangePasswordOpen(true)} title="Change password">
                  <KeyRound className="h-3.5 w-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">Password</span>
                </Button>
                <ThemeToggle />
                <Button variant="ghost" size="sm" onClick={onSignOut}>
                  Sign out
                </Button>
              </>
            )}
          </>
        }
      >
        <Outlet />
      </AppShell>
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </>
  );
}
