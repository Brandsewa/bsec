import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant, withUser } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { getAdminMe } from "../admin/me.ts";

export const DATE_FORMATS = ["dd/mm/yyyy", "mm/dd/yyyy", "yyyy-mm-dd"] as const;
export const TIME_FORMATS = ["12h", "24h"] as const;
export const LANDINGS = ["dashboard", "orders", "products", "analytics"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;

export interface AccountProfile {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  jobTitle: string | null;
  image: string | null;
  locale: string;
  timezone: string | null;
  dateFormat: string | null;
  timeFormat: string | null;
  defaultLanding: string | null;
  uiDensity: string | null;
  twoFactorEnabled: boolean;
  createdAt: string;
  /** Read-only access summary, one row per store (role and permissions come from memberships, not from this page). */
  access: { tenantId: string; storeName: string; role: string; permissions: string[]; joinedAt: string | null; invitedBy: string | null; owner: { name: string; email: string } | null }[];
}

export interface AccountProfileInput {
  name?: string | undefined;
  phone?: string | null | undefined;
  jobTitle?: string | null | undefined;
  image?: string | null | undefined;
  timezone?: string | null | undefined;
  dateFormat?: (typeof DATE_FORMATS)[number] | null | undefined;
  timeFormat?: (typeof TIME_FORMATS)[number] | null | undefined;
  defaultLanding?: (typeof LANDINGS)[number] | null | undefined;
  uiDensity?: (typeof DENSITIES)[number] | null | undefined;
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function getAccountProfile(rt: Runtime, userId: string): Promise<AccountProfile> {
  const db = rt._db.db;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!u) throw new Error("Unauthorized: user not found");
  const me = await getAdminMe(rt, userId);
  const memberships = await withUser(db, userId, (tx) =>
    tx
      .select({ tenantId: schema.memberships.tenantId, createdAt: schema.memberships.createdAt, invitedBy: schema.memberships.invitedBy })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, "active"))),
  );
  const access: AccountProfile["access"] = [];
  for (const s of me.stores) {
    const m = memberships.find((x) => x.tenantId === s.tenantId);
    let invitedBy: string | null = null;
    if (m?.invitedBy) {
      const [inviter] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, m.invitedBy)).limit(1);
      invitedBy = inviter?.name ?? null;
    }
    // Who to ask for more access: the store owner, shown to people who belong to that store only (never to the owner themselves).
    let owner: { name: string; email: string } | null = null;
    if (s.role !== "store_owner") {
      const owners = await withTenant(db, s.tenantId, (tx) =>
        tx
          .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
          .from(schema.memberships)
          .innerJoin(schema.roles, and(eq(schema.roles.tenantId, schema.memberships.tenantId), eq(schema.roles.id, schema.memberships.roleId)))
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .where(and(eq(schema.memberships.tenantId, s.tenantId), eq(schema.memberships.status, "active"), eq(schema.roles.name, "store_owner")))
          .orderBy(asc(schema.memberships.createdAt))
          .limit(10),
      );
      // Prefer the owner who granted this access; otherwise the longest-standing owner.
      const o = owners.find((x) => x.id === m?.invitedBy) ?? owners[0];
      owner = o ? { name: o.name, email: String(o.email) } : null;
    }
    access.push({ tenantId: s.tenantId, storeName: s.name, role: s.role, permissions: s.permissions, joinedAt: m?.createdAt?.toISOString() ?? null, invitedBy, owner });
  }
  return {
    id: u.id,
    email: String(u.email),
    name: u.name,
    phone: u.phone,
    jobTitle: u.jobTitle,
    image: u.image,
    locale: u.locale ?? "en",
    timezone: u.timezone,
    dateFormat: u.dateFormat,
    timeFormat: u.timeFormat,
    defaultLanding: u.defaultLanding,
    uiDensity: u.uiDensity,
    twoFactorEnabled: u.storeTwoFactorEnabled ?? false,
    createdAt: u.createdAt.toISOString(),
    access,
  };
}

/**
 * Update the caller's own profile. The email is deliberately not here: it is the sign-in identity, and changing it is a
 * separate verified flow (plan section 5), so a profile edit can never move a login or a membership.
 */
export async function updateAccountProfile(rt: Runtime, userId: string, input: AccountProfileInput): Promise<AccountProfile> {
  const patch: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Name is required");
    patch.name = name.slice(0, 120);
  }
  if (input.phone !== undefined) {
    const phone = input.phone?.trim() || null;
    if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) throw new Error("Enter a valid phone number");
    patch.phone = phone;
  }
  if (input.jobTitle !== undefined) patch.jobTitle = input.jobTitle?.trim().slice(0, 80) || null;
  if (input.image !== undefined) {
    const image = input.image?.trim() || null;
    if (image && !/^https:\/\//.test(image)) throw new Error("The picture must be an https address");
    patch.image = image;
  }
  if (input.timezone !== undefined) {
    if (input.timezone && !validTimezone(input.timezone)) throw new Error("Unknown timezone");
    patch.timezone = input.timezone || null;
  }
  if (input.dateFormat !== undefined) patch.dateFormat = input.dateFormat;
  if (input.timeFormat !== undefined) patch.timeFormat = input.timeFormat;
  if (input.defaultLanding !== undefined) patch.defaultLanding = input.defaultLanding;
  if (input.uiDensity !== undefined) patch.uiDensity = input.uiDensity;
  await rt._db.db.update(schema.users).set(patch).where(eq(schema.users.id, userId));
  return getAccountProfile(rt, userId);
}
