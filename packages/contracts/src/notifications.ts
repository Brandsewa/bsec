import { oc } from "@orpc/contract";
import { z } from "zod";

/** Notification manager contracts (docs/NOTIFICATION-MANAGER-PLAN.md, ADR-039). */

export const NotificationChannelEnum = z.enum(["in_app", "email", "sms", "whatsapp"]);

export const EmailBrandingTokens = z.object({
  logoUrl: z.string().nullable(),
  background: z.string(),
  card: z.string(),
  headerBackground: z.string(),
  headerText: z.string(),
  text: z.string(),
  mutedText: z.string(),
  accent: z.string(),
  buttonBackground: z.string(),
  buttonText: z.string(),
  linkColor: z.string(),
  fontFamily: z.enum(["system", "georgia", "trebuchet", "verdana", "tahoma", "times"]),
  baseFontSize: z.number(),
  headingScale: z.number(),
  footer: z.object({
    text: z.string(),
    address: z.string(),
    supportEmail: z.string(),
    links: z.array(z.object({ label: z.string(), url: z.string() })),
  }),
});

/** What an editor may send: every field optional, the server validates and falls back to the current value. */
export const EmailBrandingInput = z.record(z.string(), z.unknown());

export const BrandingIssue = z.object({ field: z.string(), message: z.string() });
export const BrandingView = z.object({ tokens: EmailBrandingTokens, issues: z.array(BrandingIssue) });
export const BrandingPreview = z.object({ html: z.string(), issues: z.array(BrandingIssue) });

export const InboxItem = z.object({
  id: z.string(),
  eventKey: z.string(),
  tab: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.string(),
});
export const InboxView = z.object({ items: z.array(InboxItem), unread: z.record(z.string(), z.number()), unreadTotal: z.number() });
export const InboxMark = z.object({ ids: z.array(z.string().uuid()).max(100).optional(), all: z.boolean().optional(), clear: z.boolean().optional() });

const Cell = z.object({ offered: z.boolean(), enabled: z.boolean() });

export const StoreRuleEvent = z.object({
  key: z.string(),
  audience: z.enum(["store", "customer"]),
  category: z.string(),
  label: z.string(),
  description: z.string(),
  locked: z.boolean(),
  channels: z.object({ in_app: Cell, email: Cell }),
  extraEmails: z.array(z.string()),
});

export const ActivityItem = z.object({ id: z.string(), action: z.string(), target: z.string(), actorId: z.string().nullable(), createdAt: z.string() });

/** Store admin: Settings, Notifications; the drawer; email branding. */
export const storeNotificationsContract = {
  rules: oc.route({ method: "GET", path: "/admin/notifications/rules" }).output(z.object({ events: z.array(StoreRuleEvent) })),
  updateRule: oc
    .route({ method: "PUT", path: "/admin/notifications/rules" })
    .input(z.object({ eventKey: z.string(), channel: z.enum(["in_app", "email"]), enabled: z.boolean().optional(), extraEmails: z.array(z.string()).max(5).optional() }))
    .output(z.object({ ok: z.literal(true) })),
  branding: oc.route({ method: "GET", path: "/admin/notifications/branding" }).output(z.object({ tokens: EmailBrandingTokens, issues: z.array(BrandingIssue), platform: EmailBrandingTokens })),
  updateBranding: oc.route({ method: "PUT", path: "/admin/notifications/branding" }).input(EmailBrandingInput).output(BrandingView),
  previewBranding: oc.route({ method: "POST", path: "/admin/notifications/branding/preview" }).input(EmailBrandingInput).output(BrandingPreview),
  inbox: oc.route({ method: "GET", path: "/admin/notifications/inbox" }).output(InboxView),
  markInbox: oc.route({ method: "POST", path: "/admin/notifications/inbox/mark" }).input(InboxMark).output(z.object({ ok: z.literal(true) })),
  activity: oc.route({ method: "GET", path: "/admin/notifications/activity" }).output(z.array(ActivityItem)),
};

const MatrixCell = z.object({ offered: z.boolean(), enabled: z.boolean(), connected: z.boolean() });

export const MatrixEvent = z.object({
  key: z.string(),
  audience: z.enum(["platform", "store", "customer"]),
  category: z.string(),
  label: z.string(),
  description: z.string(),
  locked: z.boolean(),
  channels: z.object({ in_app: MatrixCell, email: MatrixCell, sms: MatrixCell, whatsapp: MatrixCell }),
  roleRecipients: z.array(z.string()),
  extraEmails: z.array(z.string()),
});

/** Super Admin: the events matrix, platform email branding and the Super Admin drawer. */
export const platformNotificationsContract = {
  matrix: oc.route({ method: "GET", path: "/platform/notifications/matrix" }).output(z.object({ events: z.array(MatrixEvent), roles: z.array(z.string()), retentionDays: z.number() })),
  updateRule: oc
    .route({ method: "PUT", path: "/platform/notifications/rules" })
    .input(z.object({ eventKey: z.string(), channel: NotificationChannelEnum, enabled: z.boolean().optional(), roleRecipients: z.array(z.string()).optional(), extraEmails: z.array(z.string()).max(5).optional() }))
    .output(z.object({ ok: z.literal(true) })),
  branding: oc.route({ method: "GET", path: "/platform/notifications/branding" }).output(BrandingView),
  updateBranding: oc.route({ method: "PUT", path: "/platform/notifications/branding" }).input(EmailBrandingInput).output(BrandingView),
  previewBranding: oc.route({ method: "POST", path: "/platform/notifications/branding/preview" }).input(EmailBrandingInput).output(BrandingPreview),
  inbox: oc.route({ method: "GET", path: "/platform/notifications/inbox" }).output(InboxView),
  markInbox: oc.route({ method: "POST", path: "/platform/notifications/inbox/mark" }).input(InboxMark).output(z.object({ ok: z.literal(true) })),
};
