import { CreditCard, Landmark, LayoutDashboard, LifeBuoy, RotateCcw, ShoppingBag, Sparkles, Store, Truck, UserCog } from "lucide-react";
import type { ComponentType } from "react";

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
      { id: "branding", label: "Branding", href: "/settings/branding", description: "Logo, colours, fonts", icon: Sparkles, perm: "settings.write" },
      { id: "storefront", label: "Storefront", href: "/settings/storefront", description: "Go live, coming soon, password", icon: Store, perm: "settings.write" },
    ],
  },
  {
    id: "selling",
    label: "Selling",
    items: [
      { id: "payments", label: "Payments", href: "/settings/payments", description: "COD and Razorpay", icon: CreditCard, perm: "settings.write" },
      { id: "shipping", label: "Shipping", href: "/settings/shipping", description: "Zones, rates, free delivery", icon: Truck, perm: "settings.write" },
      { id: "taxes", label: "Taxes", href: "/settings/taxes", description: "GST and place of supply", icon: Landmark, perm: "settings.write" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { id: "orders", label: "Orders", href: "/settings/orders", description: "Numbering, processing, recovery", icon: ShoppingBag, perm: "settings.write" },
      { id: "returns", label: "Returns", href: "/settings/returns", description: "Returns and exchanges", icon: RotateCcw, perm: "settings.write" },
    ],
  },
  {
    id: "people",
    label: "People & account",
    items: [
      // Route stays /settings/team this phase; the nav label becomes "Users" (prompt §A compatibility note).
      { id: "team", label: "Users", href: "/settings/team", description: "Members and invitations", icon: UserCog, perm: "staff.manage" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance & advanced",
    items: [
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
  return SETTINGS_NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || permissions.includes(i.perm)) })).filter(
    (g) => g.items.length > 0,
  );
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
