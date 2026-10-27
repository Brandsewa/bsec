/**
 * The notification event catalog (docs/NOTIFICATION-MANAGER-PLAN.md section 3, ADR-039). Code is the source of truth for
 * which events exist, who they are for and what the defaults are; the database only stores what Super Admin and stores
 * change (notification_rules, notification_tenant_rules). Adding an event is adding an entry here.
 */

export type NotificationChannel = "in_app" | "email" | "sms" | "whatsapp";
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ["in_app", "email", "sms", "whatsapp"];

/** platform = Super Admin staff, store = a store's owner and staff, customer = a shopper of a store. */
export type NotificationAudience = "platform" | "store" | "customer";

export type StoreDrawerTab = "orders" | "system";
export type PlatformDrawerTab = "stores" | "billing" | "system";

export interface NotificationEventDef {
  key: string;
  audience: NotificationAudience;
  category: string;
  label: string;
  description: string;
  /** Locked events cannot be switched off by a store, and only Super Admin may change them (security emails). */
  locked: boolean;
  /** Which channels are available and on by default. A channel not listed is not offered for this event. */
  channels: Partial<Record<NotificationChannel, boolean>>;
  /** Drawer tab for the in-app row. */
  tab?: StoreDrawerTab | PlatformDrawerTab;
  /** Platform events: the staff roles that receive it unless Super Admin changes the rule. */
  defaultRoles?: readonly string[];
  /** Store events: the store roles that receive it. */
  storeRoles?: readonly string[];
  /** For customer events: the email template name in email-templates.ts (the key itself for most). */
  emailTemplate?: string;
  /** Plain text variables a future template editor may offer. */
  variables?: readonly string[];
}

const OWNERS = ["store_owner", "store_admin"] as const;
const PLATFORM_ADMINS = ["platform_owner", "platform_admin"] as const;

function customer(
  key: string,
  category: string,
  label: string,
  description: string,
  extra: { locked?: boolean; sms?: boolean } = {},
): NotificationEventDef {
  return {
    key,
    audience: "customer",
    category,
    label,
    description,
    locked: extra.locked ?? false,
    // SMS and WhatsApp are offered but off until a provider is connected (the adapter refuses while disabled).
    channels: { email: true, sms: false, whatsapp: false },
    emailTemplate: key,
  };
}

export const NOTIFICATION_EVENTS: readonly NotificationEventDef[] = [
  // ---- customer ---------------------------------------------------------------------------------------------------
  customer("order_confirmation", "Orders", "Order confirmation", "Sent when a shopper places an order."),
  customer("order_shipped", "Orders", "Order shipped", "Sent when the order is handed to the courier, with tracking."),
  customer("order_delivered", "Orders", "Order delivered", "Sent when the courier marks the order delivered."),
  customer("order_rto", "Orders", "Delivery failed (return to origin)", "Sent when the courier cannot deliver and returns the parcel."),
  customer("order_preorder_date_changed", "Orders", "Pre-order ship date changed", "Sent when the dispatch date of a pre-order moves."),
  customer("order_preorder_reminder", "Orders", "Pre-order ships soon", "Sent two days before a pre-order ships."),
  customer("return_requested", "Returns", "Return request received", "Sent when a shopper asks to return an order."),
  customer("refund_processed", "Returns", "Refund processed", "Sent when a refund is recorded."),
  customer("abandoned_cart_recovery", "Carts", "Abandoned cart reminder", "Reminds a shopper about items left in the cart."),
  customer("customer_welcome", "Account", "Welcome and verify email", "Sent after a shopper creates an account.", { locked: true }),
  customer("customer_account_setup", "Account", "Set up your account", "Sent so a shopper can choose a password.", { locked: true }),
  customer("customer_password_reset", "Account", "Password reset", "Sent when a shopper asks for a password reset.", { locked: true }),
  customer("password_reset", "Account", "Password reset (staff)", "Sent when a store user asks for a password reset.", { locked: true }),
  customer("password_changed", "Account", "Password changed", "Sent after a password change.", { locked: true }),
  customer("privacy_request_verify", "Account", "Privacy request verification", "Confirms a data request by email.", { locked: true }),

  // ---- store admin ------------------------------------------------------------------------------------------------
  {
    key: "store_new_order",
    audience: "store",
    category: "Orders",
    label: "New order received",
    description: "Tells the store when a shopper places an order.",
    locked: false,
    channels: { in_app: true, email: true },
    tab: "orders",
    storeRoles: OWNERS,
    variables: ["order.number", "customer.name", "order.total"],
  },
  {
    key: "billing_failed",
    audience: "store",
    category: "Billing",
    label: "Plan payment failed",
    description: "The plan charge failed; the store has a grace period.",
    locked: true,
    channels: { in_app: true, email: true },
    tab: "system",
    storeRoles: ["store_owner"],
  },
  {
    key: "billing_reminder",
    audience: "store",
    category: "Billing",
    label: "Plan payment reminder",
    description: "The plan is still unpaid and the store will be limited soon.",
    locked: true,
    channels: { in_app: true, email: true },
    tab: "system",
    storeRoles: ["store_owner"],
  },
  {
    key: "billing_limited",
    audience: "store",
    category: "Billing",
    label: "Store moved to the restricted plan",
    description: "The grace period ended without payment.",
    locked: true,
    channels: { in_app: true, email: true },
    tab: "system",
    storeRoles: ["store_owner"],
  },

  // ---- platform (Super Admin) -------------------------------------------------------------------------------------
  {
    key: "platform_store_signup",
    audience: "platform",
    category: "Stores",
    label: "New store signed up",
    description: "A new store was created through self-service signup.",
    locked: false,
    channels: { in_app: true, email: true },
    tab: "stores",
    defaultRoles: PLATFORM_ADMINS,
    variables: ["store.name", "store.slug", "owner.email"],
  },
  {
    key: "platform_billing_failed",
    audience: "platform",
    category: "Billing",
    label: "A store's plan payment failed",
    description: "A store entered its dunning grace period.",
    locked: false,
    channels: { in_app: true, email: false },
    tab: "billing",
    defaultRoles: PLATFORM_ADMINS,
  },
];

const BY_KEY = new Map(NOTIFICATION_EVENTS.map((e) => [e.key, e]));

export function getNotificationEvent(key: string): NotificationEventDef | undefined {
  return BY_KEY.get(key);
}

/** Maps an email template name to its catalog event, for the gate in the transactional sender. */
export function eventForEmailTemplate(template: string): NotificationEventDef | undefined {
  return BY_KEY.get(template);
}
