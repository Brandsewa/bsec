import React from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  Building2,
  CreditCard,
  Database,
  FileSpreadsheet,
  Flag,
  Globe,
  Headphones,
  LayoutDashboard,
  Layers,
  LogOut,
  Sliders,
  UserCheck,
  Users,
} from "lucide-react";
import { AppShell, Button, type NavGroup } from "@bs/ui";
import { signOut, type PlatformUser } from "../lib/auth.ts";

interface LayoutProps {
  user: PlatformUser;
  onLogout: () => void;
}

const navGroups: NavGroup[] = [
  {
    items: [{ label: "Overview", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "Commerce & Stores",
    items: [
      { label: "Tenants", href: "/tenants", icon: Building2 },
      { label: "Domains", href: "/domains", icon: Globe },
      { label: "Plans & Billing", href: "/plans", icon: CreditCard },
      { label: "Signups Funnel", href: "/signups", icon: Users },
      { label: "Themes", href: "/templates", icon: Layers },
    ],
  },
  {
    label: "Operations & Support",
    items: [
      { label: "Support Sessions", href: "/support", icon: Headphones },
      { label: "System & Queues", href: "/system", icon: Activity },
      { label: "Quotas & Tiers", href: "/quotas", icon: Sliders },
      { label: "Feature Flags", href: "/features", icon: Flag },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Platform Staff", href: "/staff", icon: UserCheck },
      { label: "Audit Log", href: "/audit", icon: FileSpreadsheet },
    ],
  },
];

export function Layout({ user, onLogout }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    onLogout();
    navigate({ to: "/login" as any });
  };

  return (
    <AppShell
      brand={
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <span className="text-sm font-bold tracking-tight">Super Admin</span>
        </div>
      }
      groups={navGroups}
      activeHref={location.pathname}
      banner={
        <div className="flex items-center justify-between bg-amber-500/10 px-4 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 border-b border-amber-500/20">
          <span>Super Admin Mode · Every privileged action is audited under platform BYPASSRLS</span>
          <div className="flex items-center gap-3">
            <span>Staff: <strong className="font-semibold">{user.email}</strong></span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <LogOut className="mr-1 h-3 w-3" />
              Sign Out
            </Button>
          </div>
        </div>
      }
    >
      <Outlet />
    </AppShell>
  );
}
