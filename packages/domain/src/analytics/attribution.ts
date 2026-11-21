import { and, desc, eq, gte, isNotNull, or } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { isBotUserAgent, visitorHash } from "./collect.ts";

/**
 * Order attribution without a cookie (ADR-047, Phase 2). The collector already links one visitor's page views on one day through a
 * daily-rotating hash of tenant, IP and user agent. When an order is placed, the same hash finds that visitor's page views today and
 * the last one that arrived from somewhere (an external referrer or a utm tag) is the order's source. Only the derived referrer host
 * and utm values are stored on the order, never the hash. A visit on an earlier day, Do Not Track, a bot, or a blocked beacon means
 * no row, shown as direct. This undercounts multi-day journeys by design; the report says so.
 */

export interface OrderAttributionRow {
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  landingPath: string | null;
}

export async function resolveOrderAttribution(
  rt: Runtime,
  tenantId: string,
  req: { ip: string; userAgent: string; doNotTrack?: boolean | undefined },
  opts: { secret: string; now?: Date },
): Promise<OrderAttributionRow | null> {
  try {
    if (req.doNotTrack || isBotUserAgent(req.userAgent)) return null;
    const now = opts.now ?? new Date();
    const hash = visitorHash(opts.secret, tenantId, req.ip, req.userAgent, now);
    const startOfDay = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const [row] = await withTenant(rt._db.db, tenantId, (tx) =>
      tx
        .select({
          referrerHost: schema.analyticsEvents.referrerHost,
          utmSource: schema.analyticsEvents.utmSource,
          utmMedium: schema.analyticsEvents.utmMedium,
          utmCampaign: schema.analyticsEvents.utmCampaign,
          landingPath: schema.analyticsEvents.path,
        })
        .from(schema.analyticsEvents)
        .where(
          and(
            eq(schema.analyticsEvents.tenantId, tenantId),
            eq(schema.analyticsEvents.visitorHash, hash),
            eq(schema.analyticsEvents.eventType, "pageview"),
            gte(schema.analyticsEvents.occurredAt, startOfDay),
            or(isNotNull(schema.analyticsEvents.referrerHost), isNotNull(schema.analyticsEvents.utmSource)),
          ),
        )
        .orderBy(desc(schema.analyticsEvents.occurredAt))
        .limit(1),
    );
    return row ?? null;
  } catch {
    // Attribution must never stop an order.
    return null;
  }
}
