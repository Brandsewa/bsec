import { sql } from "drizzle-orm";
import type { Db } from "@bs/db";

export interface SubdomainCheckResult {
  available: boolean;
  slug: string;
  normalizedSlug: string;
  reason?: string | undefined;
}

export interface SubdomainReservationResult {
  success: boolean;
  slug: string;
  token?: string | undefined;
  expiresAt?: Date | undefined;
  reason?: string | undefined;
}

const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

/**
 * Normalizes user-entered slug (lowercase, trim whitespace, replace spaces/underscores with hyphens).
 */
export function normalizeSubdomainSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Validates format of a subdomain slug according to RFC 1035 / PLAN §7.
 */
export function validateSubdomainFormat(slug: string): { valid: boolean; reason?: string } {
  if (!slug || slug.length < 3) {
    return { valid: false, reason: "Subdomain must be at least 3 characters long" };
  }
  if (slug.length > 63) {
    return { valid: false, reason: "Subdomain cannot exceed 63 characters" };
  }
  if (!SLUG_REGEX.test(slug)) {
    return {
      valid: false,
      reason: "Subdomain may only contain lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen",
    };
  }
  if (slug.includes("--")) {
    return { valid: false, reason: "Subdomain cannot contain consecutive hyphens" };
  }
  return { valid: true };
}

/**
 * Checks if a subdomain slug is available to be claimed or registered.
 * Checks reserved_slugs, active tenants, and unexpired reservations.
 */
export async function checkSubdomainAvailability(
  db: Db,
  rawSlug: string,
  currentLeadId?: string,
): Promise<SubdomainCheckResult> {
  const normalizedSlug = normalizeSubdomainSlug(rawSlug);
  const formatCheck = validateSubdomainFormat(normalizedSlug);

  if (!formatCheck.valid) {
    return {
      available: false,
      slug: rawSlug,
      normalizedSlug,
      reason: formatCheck.reason,
    };
  }

  // 1. Check system reserved slugs (PLAN §7)
  const reservedRes = await db.execute<{ slug: string; reason: string }>(sql`
    SELECT slug, reason FROM reserved_slugs WHERE slug = ${normalizedSlug} LIMIT 1;
  `);
  if (reservedRes.rows[0]) {
    return {
      available: false,
      slug: rawSlug,
      normalizedSlug,
      reason: "This subdomain is reserved by the platform",
    };
  }

  // 2. Check existing tenants (PLAN §5.1)
  const tenantRes = await db.execute<{ slug: string }>(sql`
    SELECT slug FROM tenants WHERE LOWER(slug) = ${normalizedSlug} LIMIT 1;
  `);
  if (tenantRes.rows[0]) {
    return {
      available: false,
      slug: rawSlug,
      normalizedSlug,
      reason: "This subdomain is already taken by another store",
    };
  }

  // 3. Check active reservations (< 30 minutes old)
  const reservationRes = await db.execute<{ slug: string; lead_id: string | null }>(sql`
    SELECT slug, lead_id FROM slug_reservations
    WHERE slug = ${normalizedSlug}
      AND expires_at > now()
    LIMIT 1;
  `);
  if (reservationRes.rows[0]) {
    const resRow = reservationRes.rows[0];
    if (currentLeadId && resRow.lead_id === currentLeadId) {
      // Subdomain is reserved by the caller's lead
      return {
        available: true,
        slug: rawSlug,
        normalizedSlug,
      };
    }
    return {
      available: false,
      slug: rawSlug,
      normalizedSlug,
      reason: "This subdomain is temporarily reserved by someone completing signup",
    };
  }

  return {
    available: true,
    slug: rawSlug,
    normalizedSlug,
  };
}

/**
 * Atomically reserves a subdomain slug with a 30-minute TTL (PLAN §7).
 * Optionally associates reservation with a signup lead id.
 */
export async function reserveSubdomain(
  db: Db,
  rawSlug: string,
  leadId?: string,
): Promise<SubdomainReservationResult> {
  const check = await checkSubdomainAvailability(db, rawSlug, leadId);
  if (!check.available) {
    return {
      success: false,
      slug: rawSlug,
      reason: check.reason,
    };
  }

  const slug = check.normalizedSlug;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes TTL

  // Delete any expired reservation on this slug first
  await db.execute(sql`
    DELETE FROM slug_reservations WHERE slug = ${slug} AND expires_at <= now();
  `);

  try {
    const res = await db.execute<{ slug: string }>(sql`
      INSERT INTO slug_reservations (slug, lead_id, expires_at, created_at)
      VALUES (${slug}, ${leadId ?? null}, ${expiresAt.toISOString()}, now())
      ON CONFLICT (slug) DO UPDATE
        SET expires_at = EXCLUDED.expires_at,
            lead_id = EXCLUDED.lead_id
        WHERE slug_reservations.lead_id IS NOT DISTINCT FROM EXCLUDED.lead_id
           OR slug_reservations.expires_at <= now()
      RETURNING slug;
    `);

    if (!res.rows[0]) {
      return {
        success: false,
        slug,
        reason: "Subdomain was just reserved by another user. Please choose another.",
      };
    }

    return {
      success: true,
      slug,
      expiresAt,
    };
  } catch {
    // Unique violation if raced simultaneously
    return {
      success: false,
      slug,
      reason: "Subdomain was just reserved by another user. Please choose another.",
    };
  }
}

/**
 * Releases a subdomain reservation (e.g. user abandoned or changed slug).
 */
export async function releaseSubdomainReservation(
  db: Db,
  slug: string,
): Promise<void> {
  const normSlug = normalizeSubdomainSlug(slug);
  await db.execute(sql`
    DELETE FROM slug_reservations WHERE slug = ${normSlug};
  `);
}

/**
 * Confirms that a reservation is still valid for this slug.
 */
export async function verifySubdomainReservation(
  db: Db,
  slug: string,
  leadId?: string,
): Promise<boolean> {
  const normSlug = normalizeSubdomainSlug(slug);
  if (leadId) {
    const res = await db.execute<{ slug: string }>(sql`
      SELECT slug FROM slug_reservations
      WHERE slug = ${normSlug}
        AND lead_id = ${leadId}
        AND expires_at > now()
      LIMIT 1;
    `);
    if (res.rows[0]) return true;
  }

  // If no leadId was provided, check if it's reserved (still active)
  const activeRes = await db.execute<{ slug: string }>(sql`
    SELECT slug FROM slug_reservations
    WHERE slug = ${normSlug}
      AND expires_at > now()
    LIMIT 1;
  `);
  if (activeRes.rows[0]) return true;

  // Otherwise check if slug is still unreserved and unowned
  const avail = await checkSubdomainAvailability(db, normSlug);
  return avail.available;
}
