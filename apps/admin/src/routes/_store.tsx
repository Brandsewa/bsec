import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { Home, Package, Settings, ShoppingBag, Users, Warehouse } from "lucide-react";
import { AppShell, PageSkeleton, type NavGroup } from "@bs/ui";

/** Store admin shell (PLAN §8). Store switcher, permissions and real data arrive in M1+. */
const nav: NavGroup[] = [
  { items: [{ label: "Home", href: "/", icon: Home }] },
  {
    label: "Sell",
    items: [
      { label: "Orders", href: "/orders", icon: ShoppingBag },
      { label: "Products", href: "/products", icon: Package },
      { label: "Inventory", href: "/inventory", icon: Warehouse },
      { label: "Customers", href: "/customers", icon: Users },
    ],
  },
  { items: [{ label: "Settings", href: "/settings", icon: Settings }] },
];

export const Route = createFileRoute("/_store")({
  pendingComponent: () => <PageSkeleton />,
  component: StoreShell,
});

function StoreShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <AppShell brand={<span className="text-sm font-semibold">Bs Commerce</span>} groups={nav} activeHref={pathname}>
      <Outlet />
    </AppShell>
  );
}
