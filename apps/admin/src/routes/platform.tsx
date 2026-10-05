import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { Activity, Building2, Flag, LayoutDashboard } from "lucide-react";
import { AppShell, PageHeaderSkeleton, type NavGroup } from "@bs/ui";

/**
 * Super Admin shell at /platform (PLAN §6). Talks only to the Platform API container.
 * platform_staff + MFA gating arrives in M1; screens in M9.
 */
const nav: NavGroup[] = [
  { items: [{ label: "Overview", href: "/platform", icon: LayoutDashboard }] },
  {
    label: "Platform",
    items: [
      { label: "Tenants", href: "/platform/tenants", icon: Building2 },
      { label: "Features", href: "/platform/features", icon: Flag },
      { label: "System", href: "/platform/system", icon: Activity },
    ],
  },
];

export const Route = createFileRoute("/platform")({
  pendingComponent: () => <PageHeaderSkeleton />,
  component: PlatformShell,
});

function PlatformShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <AppShell
      brand={<span className="text-sm font-semibold">Bs Platform</span>}
      groups={nav}
      activeHref={pathname}
      banner={<div className="bg-[var(--warning-soft)] px-4 py-1.5 text-xs text-[var(--warning)] font-medium border-b border-[var(--border)]">Super Admin · every action is audited</div>}
    >
      <Outlet />
    </AppShell>
  );
}
