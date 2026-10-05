import { CreditCard, Globe, History, Landmark, LayoutDashboard, LifeBuoy, Receipt, RotateCcw, ShoppingBag, ShoppingCart, Sparkles, Store, Truck, UserCheck, UserCog } from "lucide-react";
import type { ComponentType } from "react";
import { hasPermission, type StorePermission } from "@bs/auth";

export interface SettingsNavItem {
  id: string;
  label: string;
  /** Route path of the section. */
  href: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  /** Permission the store role must hold to see the section; omitted means everyone signed in. */
  perm?: string;
}

export interface SettingsNavGroup {
  id: string;
  label: string;
  items: readonly SettingsNavItem[];
}

/**
 * The sections of the Settings workspace in display order, grouped per the rebuild plan
 * (docs/SETTINGS-REBUILD-PLAN.md §2; builder prompt §B). Permissions stay per-item on the existing
 * model (`settings.write`/`staff.manage`) so a later granular permission split only touches this file.
 */
export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { id: "overview", label: "Overview", href: "/settings", description: "Store status and setup", icon: LayoutDashboard, perm: "settings.write" },
    ],
  },
  {
    id: "store",
    label: "Store",
    items: [
      { id: "store-details", label: "Store details", href: "/settings/store-details", description: "Name, contact, address", icon: Store, perm: "settings.write" },
      { id: "branding", label: "Branding", href: "/settings/branding", description: "Logo, colours, fonts", icon: Sparkles, perm: "branding.manage" },
      { id: "storefront", label: "Storefront", href: "/settings/storefront", description: "Go live, coming soon, password", icon: Store, perm: "storefront.manage" },
      { id: "domains", label: "Domains", href: "/settings/domains", description: "Custom domains and DNS", icon: Globe, perm: "domains.manage" },
    ],
  },
  {
    id: "selling",
    label: "Selling",
    items: [
      { id: "checkout", label: "Checkout", href: "/settings/checkout", description: "Fields, account options, recovery", icon: ShoppingCart, perm: "checkout.manage" },
      { id: "customer-accounts", label: "Customer accounts", href: "/settings/customer-accounts", description: "Sign-in methods, returns, portal", icon: UserCheck, perm: "checkout.manage" },
      { id: "payments", label: "Payments", href: "/settings/payments", description: "COD and Razorpay", icon: CreditCard, perm: "payments.manage" },
      { id: "shipping", label: "Shipping", href: "/settings/shipping", description: "Zones, rates, free delivery", icon: Truck, perm: "shipping.manage" },
      { id: "taxes", label: "Taxes", href: "/settings/taxes", description: "GST and place of supply", icon: Landmark, perm: "taxes.manage" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { id: "orders", label: "Orders", href: "/settings/orders", description: "Numbering, processing, recovery", icon: ShoppingBag, perm: "orders.settings.manage" },
      { id: "returns", label: "Returns", href: "/settings/returns", description: "Returns and exchanges", icon: RotateCcw, perm: "settings.write" },
    ],
  },
  {
    id: "people",
    label: "People & account",
    items: [
      { id: "users", label: "Users", href: "/settings/users", description: "Members and invitations", icon: UserCog, perm: "staff.manage" },
      { id: "plan-and-billing", label: "Plan & billing", href: "/settings/plan-and-billing", description: "Subscription, usage, invoices", icon: Receipt, perm: "settings.read" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance & advanced",
    items: [
      { id: "activity", label: "Activity", href: "/settings/activity", description: "Settings audit history", icon: History, perm: "audit.read" },
      { id: "support", label: "Support access", href: "/settings/support", description: "Platform support sessions", icon: LifeBuoy, perm: "settings.write" },
    ],
  },
];

/** Flat list in display order (mobile chooser, active-item search). */
export const SETTINGS_NAV: readonly SettingsNavItem[] = SETTINGS_NAV_GROUPS.flatMap((g) => g.items);

/**
 * The groups a role may see, omitting groups left empty after permission filtering
 * (prompt §B: "omitting empty groups after permission filtering").
 */
export function visibleSettingsGroups(permissions: readonly string[]): readonly SettingsNavGroup[] {
  return SETTINGS_NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.perm || hasPermission(permissions, i.perm as StorePermission)),
  })).filter((g) => g.items.length > 0);
}

/** The section that matches the current path best (/settings must not stay lit on /settings/taxes). */
export function activeSettingsItem(items: readonly SettingsNavItem[], pathname: string): SettingsNavItem | undefined {
  let best: SettingsNavItem | undefined;
  for (const item of items) {
    const matches = pathname === item.href || (item.href !== "/settings" && pathname.startsWith(`${item.href}/`));
    if (matches && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}
