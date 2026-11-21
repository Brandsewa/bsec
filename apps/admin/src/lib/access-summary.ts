import { hasPermission, type StorePermission } from "@bs/auth/permissions";

/**
 * Presentation only. This turns a person's permission identifiers into the grouped, plain-language rows shown on
 * Account, Permissions. It never decides what anyone may do: every check stays in the domain services
 * (`assertPermission`), which read the same permissions.
 */
export type AccessLevel = "manage" | "view" | "none";

export const ACCESS_LABEL: Record<AccessLevel, string> = { manage: "Manage", view: "View only", none: "No access" };

export interface CapabilityRow {
  key: string;
  label: string;
  description: string;
  level: AccessLevel;
  /** True when the access includes something that moves money, deletes data, exports data or changes who has access. */
  sensitive: boolean;
  /** What exactly is allowed, in words, for the row's detail line. */
  detail: string;
}

interface GroupDef {
  key: string;
  label: string;
  description: string;
  /** Any of these gives "Manage". */
  manage: StorePermission[];
  /** Any of these (and no manage permission) gives "View only". */
  view?: StorePermission[];
  /** Holding any of these makes the row "Sensitive access". */
  sensitive?: StorePermission[];
  manageText: string;
  viewText?: string;
  sensitiveText?: string;
}

const SETTINGS_FAMILIES: StorePermission[] = [
  "settings.write",
  "settings.manage",
  "branding.manage",
  "checkout.manage",
  "orders.settings.manage",
  "returns.manage",
  "notifications.manage",
  "domains.manage",
  "policies.manage",
  "privacy.manage",
  "apps.manage",
  "markets.manage",
];

const GROUPS: GroupDef[] = [
  {
    key: "products",
    label: "Products & inventory",
    description: "Catalogue, stock levels and collections.",
    manage: ["products.write"],
    view: ["products.read"],
    manageText: "Add, edit and remove products and stock",
    viewText: "See products and stock, but not change them",
  },
  {
    key: "orders",
    label: "Orders & fulfilment",
    description: "Take, edit and ship orders.",
    manage: ["orders.write"],
    view: ["orders.read"],
    sensitive: ["orders.delete"],
    manageText: "Create and update orders, mark them shipped",
    viewText: "See orders, but not change them",
    sensitiveText: "Can permanently delete orders",
  },
  {
    key: "refunds",
    label: "Refunds",
    description: "Return money to customers.",
    manage: ["orders.refund"],
    sensitive: ["orders.refund"],
    manageText: "Issue refunds",
    sensitiveText: "Moves money back to customers",
  },
  {
    key: "customers",
    label: "Customers",
    description: "Customer records, notes and segments.",
    manage: ["customers.write"],
    view: ["customers.read"],
    manageText: "Edit customers, tags and notes",
    viewText: "See customers, but not change them",
  },
  {
    key: "storefront",
    label: "Storefront & content",
    description: "Theme, pages, blog, discounts and policies.",
    manage: ["content.write", "theme.publish", "discounts.write", "storefront.manage", "policies.manage"],
    manageText: "Edit pages and content, publish the theme, run discounts",
  },
  {
    key: "payments",
    label: "Payments",
    description: "Payment providers and the store's books.",
    manage: ["payments.manage", "finance.write"],
    view: ["finance.read"],
    sensitive: ["payments.manage", "finance.write"],
    manageText: "Connect payment providers and edit the books",
    viewText: "See the finance books, but not change them",
    sensitiveText: "Controls how the store gets paid and its financial records",
  },
  {
    key: "shipping",
    label: "Shipping & taxes",
    description: "Rates, zones and tax rules.",
    manage: ["shipping.manage", "taxes.manage"],
    manageText: "Change shipping rates and tax rules",
  },
  {
    key: "settings",
    label: "Settings",
    description: "Store details, domains, notifications and privacy.",
    manage: SETTINGS_FAMILIES,
    view: ["settings.read", "audit.read"],
    manageText: "Change store settings",
    viewText: "See settings and the activity log, but not change them",
  },
  {
    key: "team",
    label: "Team",
    description: "Who can sign in to this store and what they can do.",
    manage: ["staff.manage"],
    sensitive: ["staff.manage"],
    manageText: "Invite people and change their roles",
    sensitiveText: "Controls who has access to the store",
  },
  {
    key: "analytics",
    label: "Analytics & exports",
    description: "Reports and data downloads.",
    manage: ["exports.run"],
    view: ["analytics.read"],
    sensitive: ["exports.run"],
    manageText: "See reports and download data exports",
    viewText: "See reports, but not download exports",
    sensitiveText: "Can download store data",
  },
];

const anyOf = (granted: readonly string[], list: readonly StorePermission[] | undefined) => (list ?? []).some((p) => hasPermission(granted, p));

/** Grouped capability rows for one store. Pass the permissions already merged by the server (`access[].permissions`). */
export function summarizeAccess(granted: readonly string[]): CapabilityRow[] {
  return GROUPS.map((g) => {
    const canManage = anyOf(granted, g.manage);
    const canView = !canManage && anyOf(granted, g.view);
    const level: AccessLevel = canManage ? "manage" : canView ? "view" : "none";
    const sensitive = level !== "none" && anyOf(granted, g.sensitive);
    const detail =
      level === "manage" ? g.manageText : level === "view" ? (g.viewText ?? "") : "You cannot open this area";
    return { key: g.key, label: g.label, description: g.description, level, sensitive, detail: sensitive && g.sensitiveText ? `${detail}. ${g.sensitiveText}` : detail };
  });
}

/** The store owner system role is defined as holding everything, so it is shown as one line instead of every permission. */
export const isFullAccessRole = (roleName: string) => roleName === "store_owner";

const ROLE_TEXT: Record<string, string> = {
  store_owner: "You own this store. You can do everything, including payments and who has access.",
  store_admin: "You can run the store day to day: products, orders, customers, content, settings and the team. Payment provider settings stay with the owner.",
  store_finance: "You can see and edit the store's financial books, and nothing else.",
};

const humanRole = (role: string) => role.replace(/^store_/, "").replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export const roleDisplayName = (role: string) => (role === "store_owner" ? "Owner" : humanRole(role));

/** One plain sentence about the role: fixed wording for the system roles, generated from the rows for custom ones. */
export function roleSummary(roleName: string, rows: readonly CapabilityRow[]): string {
  const fixed = ROLE_TEXT[roleName];
  if (fixed) return fixed;
  const manage = rows.filter((r) => r.level === "manage").map((r) => r.label.toLowerCase());
  const view = rows.filter((r) => r.level === "view").map((r) => r.label.toLowerCase());
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const parts: string[] = [];
  if (manage.length) parts.push(`manage ${list(manage)}`);
  if (view.length) parts.push(`view ${list(view)}`);
  return parts.length ? `You can ${parts.join(", and ")}.` : "You do not have access to any store area yet.";
}
