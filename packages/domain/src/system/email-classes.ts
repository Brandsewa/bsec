/**
 * Notification preferences and email classification (Settings Rebuild Phase 7, Slice 7A).
 * Strict adherence to:
 * - Email is the ONLY channel (no SMS / WhatsApp).
 * - Defaults equal today's behavior (all customer event emails enabled by default).
 * - accountSecurity is locked on (true) and cannot be disabled.
 * - Email classes: transactional, security, marketing.
 */

export type EmailClass = "transactional" | "security" | "marketing";

export const EMAIL_CLASS: Record<string, EmailClass> = {
  // Transactional
  order_confirmation: "transactional",
  order_shipped: "transactional",
  order_delivered: "transactional",
  order_rto: "transactional",
  return_requested: "transactional",
  refund_processed: "transactional",
  order_preorder_date_changed: "transactional",
  order_preorder_reminder: "transactional",
  staff_order_created: "transactional",

  // Security (cannot be disabled or suppressed by preferences or consent)
  password_reset: "security",
  password_changed: "security",
  customer_welcome: "security",
  customer_password_reset: "security",
  customer_account_setup: "security",
  privacy_request_verify: "security",

  // Marketing (requires subscribed consent, includes List-Unsubscribe headers)
  abandoned_cart_recovery: "marketing",
  newsletter: "marketing",
  promotional: "marketing",
};

export interface NotificationPreferencesV1 {
  v: 1;
  sender: {
    displayName?: string | undefined; // 1..60, plain text
    replyToEmail?: string | undefined; // valid email
  };
  customer: {
    orderConfirmation: boolean;
    shipment: boolean;
    delivery: boolean;
    cancellation: boolean;
    refund: boolean;
    returnUpdates: boolean;
    preorderReminders: boolean;
    accountSecurity: true; // locked on: password reset, email verification
  };
  staff: {
    newOrder: {
      enabled: boolean;
      recipients: string[]; // 0..5 valid emails
    };
  };
  footerNote?: string | undefined; // 0..300 plain text, escaped when rendered
  channels: {
    email: true;
  };
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesV1 = {
  v: 1,
  sender: {},
  customer: {
    orderConfirmation: true,
    shipment: true,
    delivery: true,
    cancellation: true,
    refund: true,
    returnUpdates: true,
    preorderReminders: true,
    accountSecurity: true,
  },
  staff: {
    newOrder: {
      enabled: false,
      recipients: [],
    },
  },
  channels: {
    email: true,
  },
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates and parses notification preferences JSON into NotificationPreferencesV1.
 * Defaults match today's behavior. accountSecurity is strictly locked to true.
 */
export function parseNotificationPreferences(raw: unknown): NotificationPreferencesV1 {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  const obj = raw as Record<string, unknown>;
  const senderObj = (obj.sender && typeof obj.sender === "object" ? obj.sender : {}) as Record<string, unknown>;
  const customerObj = (obj.customer && typeof obj.customer === "object" ? obj.customer : {}) as Record<string, unknown>;
  const staffObj = (obj.staff && typeof obj.staff === "object" ? obj.staff : {}) as Record<string, unknown>;
  const staffNewOrder = (staffObj.newOrder && typeof staffObj.newOrder === "object" ? staffObj.newOrder : {}) as Record<string, unknown>;

  // Clean displayName (reject address-like strings or format)
  let displayName: string | undefined;
  if (typeof senderObj.displayName === "string") {
    // If displayName contains <...> or @, strip or extract just the text portion
    let sanitized = senderObj.displayName.replace(/<[^>]+>/g, "").trim();
    if (sanitized.includes("@")) {
      sanitized = "";
    }
    if (sanitized.length > 0 && sanitized.length <= 60) {
      displayName = sanitized;
    }
  }

  let replyToEmail: string | undefined;
  if (typeof senderObj.replyToEmail === "string") {
    const trimmed = senderObj.replyToEmail.trim().toLowerCase();
    if (EMAIL_REGEX.test(trimmed)) {
      replyToEmail = trimmed;
    }
  }

  let footerNote: string | undefined;
  if (typeof obj.footerNote === "string") {
    const trimmed = obj.footerNote.trim();
    if (trimmed.length > 0) {
      footerNote = trimmed.slice(0, 300);
    }
  }

  // Staff recipients: 0..5 valid unique emails
  const staffRecipients: string[] = [];
  if (Array.isArray(staffNewOrder.recipients)) {
    for (const item of staffNewOrder.recipients) {
      if (typeof item === "string") {
        const cleaned = item.trim().toLowerCase();
        if (EMAIL_REGEX.test(cleaned) && !staffRecipients.includes(cleaned) && staffRecipients.length < 5) {
          staffRecipients.push(cleaned);
        }
      }
    }
  }

  return {
    v: 1,
    sender: {
      displayName,
      replyToEmail,
    },
    customer: {
      orderConfirmation: customerObj.orderConfirmation !== false,
      shipment: customerObj.shipment !== false,
      delivery: customerObj.delivery !== false,
      cancellation: customerObj.cancellation !== false,
      refund: customerObj.refund !== false,
      returnUpdates: customerObj.returnUpdates !== false,
      preorderReminders: customerObj.preorderReminders !== false,
      accountSecurity: true, // locked on
    },
    staff: {
      newOrder: {
        enabled: Boolean(staffNewOrder.enabled),
        recipients: staffRecipients,
      },
    },
    footerNote,
    channels: {
      email: true,
    },
  };
}

/**
 * Maps a template name to its corresponding customer preference toggle, if any.
 * Returns null if the template is not governed by a customer preference (e.g. security or staff).
 */
export function getTemplatePreferenceField(template: string): keyof NotificationPreferencesV1["customer"] | null {
  switch (template) {
    case "order_confirmation":
      return "orderConfirmation";
    case "order_shipped":
      return "shipment";
    case "order_delivered":
      return "delivery";
    case "order_rto":
      return "cancellation";
    case "refund_processed":
      return "refund";
    case "return_requested":
      return "returnUpdates";
    case "order_preorder_reminder":
    case "order_preorder_date_changed":
      return "preorderReminders";
    case "password_reset":
    case "password_changed":
    case "customer_welcome":
    case "customer_password_reset":
    case "customer_account_setup":
    case "privacy_request_verify":
      return "accountSecurity";
    default:
      return null;
  }
}
