import { sql } from "drizzle-orm";
import type { Db } from "@bs/db";
import { checkRateLimit } from "./rate-limit.ts";

/**
 * Sign-in throttling that counts FAILED attempts only, so a busy admin who signs in successfully many
 * times is never locked out, while guessing passwords is capped per account and per address.
 * Uses the shared Postgres counters (rate_limit_counters), so it holds across containers.
 */
const WINDOW_SECONDS = 15 * 60;
export const MAX_LOGIN_FAILURES_PER_EMAIL = 5;
export const MAX_LOGIN_FAILURES_PER_IP = 20;

const emailKey = (email: string) => `login:fail:email:${email.trim().toLowerCase()}`;
const ipKey = (ip: string) => `login:fail:ip:${ip}`;

/** Seconds to wait if this email or address is currently locked out, otherwise null. Does not count. */
export async function loginRetryAfter(db: Db, ip: string, email: string): Promise<number | null> {
  const res = await db.execute<{ key: string; count: number; retry_after: number }>(sql`
    SELECT key, count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - now()))))::int AS retry_after
      FROM rate_limit_counters
     WHERE key IN (${emailKey(email)}, ${ipKey(ip)}) AND expires_at > now()
  `);
  let wait: number | null = null;
  for (const row of res.rows) {
    const limit = row.key.startsWith("login:fail:email:") ? MAX_LOGIN_FAILURES_PER_EMAIL : MAX_LOGIN_FAILURES_PER_IP;
    if (Number(row.count) >= limit) wait = Math.max(wait ?? 0, Number(row.retry_after));
  }
  return wait;
}

export async function recordLoginFailure(db: Db, ip: string, email: string): Promise<void> {
  await checkRateLimit(db, { key: emailKey(email), limit: MAX_LOGIN_FAILURES_PER_EMAIL, windowSeconds: WINDOW_SECONDS });
  await checkRateLimit(db, { key: ipKey(ip), limit: MAX_LOGIN_FAILURES_PER_IP, windowSeconds: WINDOW_SECONDS });
}

/** A successful sign-in clears the account's failure count. */
export async function clearLoginFailures(db: Db, email: string): Promise<void> {
  await db.execute(sql`DELETE FROM rate_limit_counters WHERE key = ${emailKey(email)}`);
}
