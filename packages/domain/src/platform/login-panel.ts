import { eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta } from "../platform-services.ts";

/**
 * The content panel beside the admin sign-in form (40% of the screen on desktop). Plain validated data: text, colours and an
 * optional picture URL. No HTML, CSS or script from the editor (ADR-010).
 */
export interface LoginPanel {
  heading: string;
  body: string;
  /** Text colour on the panel. */
  textColor: string;
  /** Gradient start and end. Equal colours give a flat background. */
  backgroundFrom: string;
  backgroundTo: string;
  /** Optional https picture drawn over the gradient (the gradient shows while it loads or when it is empty). */
  imageUrl: string | null;
  /** Where the heading and text sit in the panel. */
  verticalAlign: "top" | "middle" | "bottom";
}

export const DEFAULT_LOGIN_PANEL: LoginPanel = {
  heading: "Run your store from one place",
  body: "Manage products, orders and customers. Fast, simple and built for Indian stores.",
  textColor: "#ffffff",
  backgroundFrom: "#1e1b4b",
  backgroundTo: "#4338ca",
  imageUrl: null,
  verticalAlign: "middle",
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function text(value: unknown, field: string, max: number, min = 0): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length < min) throw new Error(`${field} is required`);
  if (v.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return v;
}

function hex(value: unknown, field: string): string {
  if (typeof value !== "string" || !HEX.test(value)) throw new Error(`${field} must be a colour like #1e1b4b`);
  return value.toLowerCase();
}

/** Validates editor input into a LoginPanel (throws a readable Error). */
export function normaliseLoginPanel(input: unknown): LoginPanel {
  const i = (input ?? {}) as Record<string, unknown>;
  let imageUrl: string | null = null;
  if (typeof i.imageUrl === "string" && i.imageUrl.trim() !== "") {
    const raw = i.imageUrl.trim();
    if (raw.length > 500) throw new Error("Picture address is too long");
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new Error("Picture address must be a full https:// link");
    }
    // Uploaded pictures are served over https; a local dev media server is plain http on a *.localhost host.
    const local = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname.endsWith(".localhost"));
    if (u.protocol !== "https:" && !local) throw new Error("Picture must be an uploaded image (https)");
    imageUrl = u.toString();
  }
  return {
    heading: text(i.heading, "Heading", 80, 1),
    body: text(i.body, "Text", 240),
    textColor: hex(i.textColor, "Text colour"),
    backgroundFrom: hex(i.backgroundFrom, "Background start colour"),
    backgroundTo: hex(i.backgroundTo, "Background end colour"),
    imageUrl,
    // Rows saved before this setting have none: they stay centred.
    verticalAlign: i.verticalAlign === "top" || i.verticalAlign === "bottom" ? i.verticalAlign : "middle",
  };
}

function fromRow(raw: unknown): LoginPanel {
  try {
    return normaliseLoginPanel(raw);
  } catch {
    // A bad or missing row must never break the sign-in page.
    return DEFAULT_LOGIN_PANEL;
  }
}

/** Public, secret-free read for the sign-in page (no staff session yet). */
export async function getPublicLoginPanel(db: Db): Promise<LoginPanel> {
  const [row] = await db.select({ p: schema.platformSettings.loginPanel }).from(schema.platformSettings).where(eq(schema.platformSettings.id, "default")).limit(1);
  return row?.p ? fromRow(row.p) : DEFAULT_LOGIN_PANEL;
}

export async function getLoginPanelForStaff(rt: Runtime, platformStaffUserId: string): Promise<LoginPanel & { explicit: boolean }> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const [row] = await rt._db.db.select({ p: schema.platformSettings.loginPanel }).from(schema.platformSettings).where(eq(schema.platformSettings.id, "default")).limit(1);
  return { ...(row?.p ? fromRow(row.p) : DEFAULT_LOGIN_PANEL), explicit: Boolean(row?.p) };
}

/** Saves the panel (platform_admin and up, audited). */
export async function updateLoginPanel(rt: Runtime, platformStaffUserId: string, input: unknown, meta?: AuditMeta): Promise<LoginPanel> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "change the sign-in page content");
  const next = normaliseLoginPanel(input);
  await rt._db.db.transaction(async (tx) => {
    const [prev] = await tx.select({ p: schema.platformSettings.loginPanel }).from(schema.platformSettings).where(eq(schema.platformSettings.id, "default")).limit(1);
    await tx
      .insert(schema.platformSettings)
      .values({ id: "default", loginPanel: next, updatedBy: platformStaffUserId })
      .onConflictDoUpdate({ target: schema.platformSettings.id, set: { loginPanel: next, updatedBy: platformStaffUserId, updatedAt: sql`now()` } });
    await writePlatformAudit(tx, platformStaffUserId, "platform_settings.login_panel", "platform_settings", "default", null, { loginPanel: { from: prev?.p ?? null, to: next } }, meta);
  });
  return next;
}
