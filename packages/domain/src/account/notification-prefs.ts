import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { NOTIFICATION_EVENTS, getNotificationEvent } from "../notifications/catalog.ts";

export interface AccountAlert {
  key: string;
  label: string;
  description: string;
  category: string;
  /** Locked alerts (security) cannot be switched off. */
  locked: boolean;
  muted: boolean;
}

/** The store alerts a person can mute for themselves. Locked events are listed but cannot be muted. */
export async function listAccountAlerts(rt: Runtime, userId: string): Promise<AccountAlert[]> {
  const rows = await rt._db.db
    .select({ k: schema.userNotificationMutes.eventKey })
    .from(schema.userNotificationMutes)
    .where(eq(schema.userNotificationMutes.userId, userId));
  const muted = new Set(rows.map((r) => r.k));
  return NOTIFICATION_EVENTS.filter((e) => e.audience === "store").map((e) => ({
    key: e.key,
    label: e.label,
    description: e.description,
    category: e.category,
    locked: e.locked,
    muted: !e.locked && muted.has(e.key),
  }));
}

export async function setAccountAlertMuted(rt: Runtime, userId: string, eventKey: string, muted: boolean): Promise<void> {
  const def = getNotificationEvent(eventKey);
  if (!def || def.audience !== "store") throw new Error("Unknown alert");
  if (def.locked) throw new Error("This alert cannot be switched off");
  const db = rt._db.db;
  if (muted) await db.insert(schema.userNotificationMutes).values({ userId, eventKey }).onConflictDoNothing();
  else await db.delete(schema.userNotificationMutes).where(and(eq(schema.userNotificationMutes.userId, userId), eq(schema.userNotificationMutes.eventKey, eventKey)));
}

/** Of these people, the ones who muted this alert. The dispatcher drops them from the recipients. */
export async function mutedUserIds(db: Db, eventKey: string, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const rows = await db
    .select({ u: schema.userNotificationMutes.userId })
    .from(schema.userNotificationMutes)
    .where(and(eq(schema.userNotificationMutes.eventKey, eventKey), inArray(schema.userNotificationMutes.userId, userIds)));
  return new Set(rows.map((r) => r.u));
}
