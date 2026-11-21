import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { QUEUE_NAMES, schema, withTenant, type Db } from "@bs/db";
import { normalizeConsentSettings } from "@bs/contracts";
import type { Runtime } from "../runtime.ts";
import { getStorefrontConsentConfig } from "../privacy/service.ts";
import {
  buildMetaEventPayload,
  conversionCredentialStatus,
  decideEventTracking,
  readConversionCredentials,
  sendMetaPurchase,
  type OrderTrackingRequest,
  type ServerEventName,
} from "./conversions.ts";

/**
 * Add to cart and begin checkout, sent from the server to the Meta Conversions API (ADR-047, slice 5c). See `decideEventTracking`
 * for the rules. The row is written first and a retrying job sends it, so a slow or failing Meta never delays the shopper.
 */

export interface RecordServerEventInput {
  name: ServerEventName;
  /** Unique per event within the store. The same id is given to the browser so Meta counts the event once. */
  eventId: string;
  currency: string;
  /** Major units (what the shopper sees). */
  value: number;
  items: Array<{ id: string; quantity: number; price: number }>;
  req: OrderTrackingRequest;
}

/**
 * Records the event and queues it, when the visitor and the store allow it. Returns the event id when the event is (or already was)
 * recorded, so the page can hand the same id to the browser pixel; null when nothing is sent. Never throws: a tracking problem
 * must not break the cart.
 */
export async function recordServerEvent(rt: Runtime, tenantId: string, input: RecordServerEventInput): Promise<string | null> {
  try {
    if (input.items.length === 0 || !input.eventId || input.eventId.length > 80) return null;
    const [cfg, creds] = await Promise.all([getStorefrontConsentConfig(rt, tenantId), conversionCredentialStatus(rt._db.db, tenantId)]);
    const ctx = decideEventTracking(cfg, creds, input.req);
    if (!ctx) return null;
    const inserted = await withTenant(rt._db.db, tenantId, (tx) =>
      tx
        .insert(schema.conversionEvents)
        .values({
          tenantId,
          eventName: input.name,
          eventId: input.eventId,
          currency: input.currency,
          value: input.value.toFixed(2),
          items: input.items,
          ...ctx,
        })
        .onConflictDoNothing()
        .returning({ id: schema.conversionEvents.id }),
    );
    const row = inserted[0];
    // A repeat of an event that was already recorded (a refresh of the checkout page) is not sent again.
    if (row) await rt._jobs?.send(QUEUE_NAMES.ANALYTICS_CONVERSION_EVENT, { tenantId, id: row.id });
    return input.eventId;
  } catch {
    return null;
  }
}

/** Sends one recorded event to Meta. Same retry rules as the purchase job: network, 429 and 5xx retry; other 4xx fail for good. */
export async function handleServerEventJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; id: string },
  opts: { fetchFn?: typeof fetch } = {},
): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch;
  const { tenantId, id } = data;
  const loaded = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx.select().from(schema.conversionEvents).where(and(eq(schema.conversionEvents.tenantId, tenantId), eq(schema.conversionEvents.id, id))).limit(1);
    if (!row) return null;
    const [p] = await tx.select({ c: schema.privacySettings.consentSettings }).from(schema.privacySettings).where(eq(schema.privacySettings.tenantId, tenantId)).limit(1);
    return { row, consent: normalizeConsentSettings(p?.c) };
  });
  if (!loaded || loaded.row.metaStatus !== "pending") return;
  const { row, consent } = loaded;
  const creds = await readConversionCredentials(db, tenantId);
  const pixel = consent.integrations.metaPixelId;

  let status: "sent" | "failed" | "skipped" | "pending" = "pending";
  let detail: string | null = null;
  if (!pixel || !creds.metaAccessToken) {
    status = "skipped";
    detail = "Pixel ID or access token no longer set";
  } else {
    const payload = buildMetaEventPayload(
      {
        name: row.eventName as ServerEventName,
        eventId: row.eventId,
        eventTime: row.eventTime,
        currency: row.currency,
        value: Number(row.value),
        items: row.items as Array<{ id: string; quantity: number; price: number }>,
      },
      row,
      consent.integrations.metaTestEventCode,
      creds.metaAccessToken,
    );
    const r = await sendMetaPurchase(fetchFn, pixel, payload);
    if (r.ok) status = "sent";
    else {
      status = r.retryable ? "pending" : "failed";
      detail = r.detail;
    }
  }

  await withTenant(db, tenantId, (tx) =>
    tx
      .update(schema.conversionEvents)
      .set({
        metaStatus: status,
        metaDetail: detail,
        attempts: row.attempts + 1,
        updatedAt: new Date(),
        ...(status !== "pending" ? { clientIp: null, userAgent: null, fbp: null, fbc: null } : {}),
      })
      .where(and(eq(schema.conversionEvents.tenantId, tenantId), eq(schema.conversionEvents.id, id))),
  );
  log.info({ eventId: row.eventId, status }, "analytics.conversion_event processed");
  if (status === "pending") throw new Error("Conversion API call failed; retrying");
}
