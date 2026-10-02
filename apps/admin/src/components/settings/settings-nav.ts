import { CreditCard, Landmark, LifeBuoy, Settings, ShoppingBag, Sparkles, Store, Truck, UserCog } from "lucide-react";
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

/** The sections of the Settings workspace, in display order. */
export const SETTINGS_NAV: readonly SettingsNavItem[] = [
  { id: "general", label: "General", href: "/settings", description: "Store name, contact, address", icon: Settings, perm: "settings.write" },
  { id: "orders", label: "Orders", href: "/settings/orders", description: "Numbering, processing, recovery", icon: ShoppingBag, perm: "settings.write" },
  { id: "storefront", label: "Storefront", href: "/settings/storefront", description: "Go live, coming soon, password", icon: Store, perm: "settings.write" },
  { id: "branding", label: "Branding", href: "/settings/branding", description: "Logo, colours, fonts", icon: Sparkles, perm: "settings.write" },
  { id: "shipping", label: "Shipping", href: "/settings/shipping", description: "Zones, rates, free delivery", icon: Truck, perm: "settings.write" },
  { id: "payments", label: "Payments", href: "/settings/payments", description: "COD and Razorpay", icon: CreditCard, perm: "settings.write" },
  { id: "taxes", label: "Taxes", href: "/settings/taxes", description: "GST and place of supply", icon: Landmark, perm: "settings.write" },
  { id: "team", label: "Team", href: "/settings/team", description: "Members and invitations", icon: UserCog, perm: "staff.manage" },
  { id: "support", label: "Support access", href: "/settings/support", description: "Platform support sessions", icon: LifeBuoy, perm: "settings.write" },
];

/** The section that matches the current path best (/settings must not stay lit on /settings/taxes). */
export function activeSettingsItem(items: readonly SettingsNavItem[], pathname: string): SettingsNavItem | undefined {
  let best: SettingsNavItem | undefined;
  for (const item of items) {
    const matches = pathname === item.href || (item.href !== "/settings" && pathname.startsWith(`${item.href}/`));
    if (matches && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}
