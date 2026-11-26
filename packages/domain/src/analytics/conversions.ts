import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { schema, tenantSecrets, withTenant, type Db } from "@bs/db";
import { decryptSecret } from "@bs/payments";
import { normalizeConsentSettings, type PublicConsentConfig } from "@bs/contracts";
import type { Logger } from "pino";
import { buildPurchaseEvent } from "./shop-events.ts";

/**
 * Server-side conversion APIs: Meta Conversions API and GA4 Measurement Protocol (ADR-047, docs/ANALYTICS-PLAN.md slice 5).
 *
 * Why: browser events miss visitors with ad blockers. The server sends the same `Purchase` (same event id / transaction id, so the
 * platforms de-duplicate against the browser event) after the order is committed.
 *
 * Privacy rules, all enforced here:
 * - Nothing is sent unless the visitor accepted the matching category (`bs_consent` cookie of the current revision, read when the
 *   order is placed): marketing for Meta, analytics for GA4.
 * - Nothing is sent unless the merchant saved the credential, and the matching id is still configured.
 * - Customer email and phone are read from the order at send time and sent hashed (SHA-256, as Meta requires); GA4 gets no personal data.
 * - Request details (IP, user agent, browser ids) are kept only until the order's events settle, then cleared.
 * - Credentials are AES-256-GCM encrypted in `tenant_secrets` and never returned to the browser or logged.
 */

export const META_CAPI_VERSION = "v21.0";
const META_PROVIDER = "meta_capi";
const GA4_PROVIDER = "ga4_mp";
const META_KEY = "access_token";
const GA4_KEY = "api_secret";
const TIMEOUT_MS = 8000;
/** Orders whose events are still pending after this long are given up on and their request details cleared. */
export const CONVERSION_GIVE_UP_HOURS = 48;
/** Tracking rows are deleted this long after the order. */
export const ORDER_TRACKING_RETENTION_DAYS = 30;
/** Add to cart and begin checkout rows are deleted this long after the event. */
export const TRACKING_EVENT_RETENTION_DAYS = 7;

export const META_SECRET = { provider: META_PROVIDER, keyName: META_KEY } as const;
export const GA4_SECRET = { provider: GA4_PROVIDER, keyName: GA4_KEY } as const;

type Fetch = typeof fetch;

// ---------------------------------------------------------------------------------------------
// Reading the shopper's choice and browser ids from the order request
// ---------------------------------------------------------------------------------------------

/** `bs_consent` is `<revision>.<analytics><marketing>`, e.g. `182a16db.10`. Null when absent, malformed or from another revision. */
export function parseConsentCookie(value: string | null | undefined, rev: string): { analytics: boolean; marketing: boolean } | null {
  if (!value) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const [r, flags] = decoded.split(".");
  if (r !== rev || !flags || !/^[01]{2}$/.test(flags)) return null;
  return { analytics: flags[0] === "1", marketing: flags[1] === "1" };
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** GA4's `_ga` cookie is `GA1.1.<id>.<timestamp>`; the Measurement Protocol client id is the last two parts. */
export function gaClientIdFromCookie(value: string | null | undefined): string | null {
  const m = /^GA\d\.\d+\.(\d{4,12}\.\d{8,12})$/.exec(value ?? "");
  return m?.[1] ?? null;
}

const FB_ID = /^[A-Za-z0-9._-]{6,200}$/;

// ---------------------------------------------------------------------------------------------
// Hashing and payloads
// ---------------------------------------------------------------------------------------------

export const sha256Hex = (v: string): string => createHash("sha256").update(v).digest("hex");

export function hashedEmail(email: string | null | undefined): string | null {
  const v = (email ?? "").trim().toLowerCase();
  return v.includes("@") ? sha256Hex(v) : null;
}

/** Digits only, with the country code Meta expects: a 10-digit number on an INR store gets 91. */
export function hashedPhone(phone: string | null | undefined, currency: string): string | null {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10 && currency === "INR") d = `91${d}`;
  return d.length >= 8 && d.length <= 15 ? sha256Hex(d) : null;
}

export interface ConversionOrder {
  number: string;
  status: string;
  currency: string;
  email: string | null;
  phone: string | null;
  grandTotal: number;
  shippingTotal: number;
  placedAt: Date;
  items: Array<{ variantId: string | null; sku: string | null; productTitle: string; variantTitle: string | null; quantity: number; unitPrice: number }>;
}

export interface ConversionTracking {
  clientIp: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  gaClientId: string | null;
  sourceUrl: string | null;
}

export function buildMetaPurchasePayload(order: ConversionOrder, t: ConversionTracking, testEventCode: string | null, token: string) {
  const ev = buildPurchaseEvent(order);
  if (!ev || ev.t !== "purchase") return null;
  const userData: Record<string, unknown> = {};
  const em = hashedEmail(order.email);
  const ph = hashedPhone(order.phone, order.currency);
  if (em) userData["em"] = [em];
  if (ph) userData["ph"] = [ph];
  if (t.clientIp) userData["client_ip_address"] = t.clientIp;
  if (t.userAgent) userData["client_user_agent"] = t.userAgent;
  if (t.fbp) userData["fbp"] = t.fbp;
  if (t.fbc) userData["fbc"] = t.fbc;
  return {
    access_token: token,
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
    data: [
      {
        event_name: "Purchase",
        // Same id as the browser event (`eventID` in bsc.js) so Meta counts the order once.
        event_id: ev.orderId,
        event_time: Math.floor(order.placedAt.getTime() / 1000),
        action_source: "website",
        ...(t.sourceUrl ? { event_source_url: t.sourceUrl } : {}),
        user_data: userData,
        custom_data: {
          currency: ev.currency,
          value: ev.value,
          order_id: ev.orderId,
          content_type: "product",
          content_ids: ev.items.map((i) => i.id),
          contents: ev.items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.price })),
          num_items: ev.items.reduce((n, i) => n + i.quantity, 0),
        },
      },
    ],
  };
}

export function buildGa4PurchasePayload(order: ConversionOrder, clientId: string) {
  const ev = buildPurchaseEvent(order);
  if (!ev || ev.t !== "purchase") return null;
  return {
    client_id: clientId,
    events: [
      {
        name: "purchase",
        params: {
          currency: ev.currency,
          value: ev.value,
          // GA4 de-duplicates purchases that share a transaction id, so the browser event and this one count once.
          transaction_id: ev.orderId,
          shipping: ev.shipping,
          items: ev.items.map((i) => ({ item_id: i.id, item_name: i.name, ...(i.variant ? { item_variant: i.variant } : {}), price: i.price, quantity: i.quantity })),
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------

export type SendResult = { ok: true } | { ok: false; retryable: boolean; detail: string };

/** A short, safe description of a failed call. Never contains the credential. */
function describeFailure(status: number, text: string, secret: string): string {
  let msg = text;
  try {
    const j = JSON.parse(text) as { error?: { message?: string } };
    msg = j.error?.message ?? text;
  } catch {
    // not JSON: use the raw text
  }
  return `HTTP ${status}: ${msg.split(secret).join("***").replace(/\s+/g, " ").slice(0, 200)}`;
}

async function post(fetchFn: Fetch, url: string, body: unknown, secret: string): Promise<SendResult> {
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    const retryable = res.status === 429 || res.status >= 500;
    return { ok: false, retryable, detail: describeFailure(res.status, await res.text().catch(() => ""), secret) };
  } catch (err) {
    // Network failure or timeout: try again later. The message is kept generic so a URL (which carries the GA4 secret) never leaks.
    return { ok: false, retryable: true, detail: `Network error: ${err instanceof Error ? err.name : "unknown"}` };
  }
}

export interface MetaPayload {
  access_token: string;
  [key: string]: unknown;
}

export function sendMetaPurchase(fetchFn: Fetch, pixelId: string, payload: MetaPayload): Promise<SendResult> {
  // The token travels in the body, not the URL, so it cannot end up in access logs.
  return post(fetchFn, `https://graph.facebook.com/${META_CAPI_VERSION}/${encodeURIComponent(pixelId)}/events`, payload, payload.access_token);
}

export function sendGa4Purchase(fetchFn: Fetch, measurementId: string, apiSecret: string, payload: NonNullable<ReturnType<typeof buildGa4PurchasePayload>>): Promise<SendResult> {
  // The Measurement Protocol only accepts the secret in the query string.
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  return post(fetchFn, url, payload, apiSecret);
}

// ---------------------------------------------------------------------------------------------
// Credentials (tenant_secrets, encrypted)
// ---------------------------------------------------------------------------------------------

export async function readConversionCredentials(db: Db, tenantId: string): Promise<{ metaAccessToken: string | null; ga4ApiSecret: string | null }> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ provider: tenantSecrets.provider, ciphertext: tenantSecrets.ciphertext, iv: tenantSecrets.iv })
      .from(tenantSecrets)
      .where(and(eq(tenantSecrets.tenantId, tenantId), sql`${tenantSecrets.provider} IN (${META_PROVIDER}, ${GA4_PROVIDER})`)),
  );
  const out = { metaAccessToken: null as string | null, ga4ApiSecret: null as string | null };
  for (const r of rows) {
    try {
      const v = decryptSecret({ ciphertext: r.ciphertext, iv: r.iv });
      if (r.provider === META_PROVIDER) out.metaAccessToken = v;
      else out.ga4ApiSecret = v;
    } catch {
      // unreadable (key changed): treated as not set
    }
  }
  return out;
}

/** Only whether each credential exists: safe to show. */
export async function conversionCredentialStatus(db: Db, tenantId: string): Promise<{ metaAccessTokenSet: boolean; ga4ApiSecretSet: boolean }> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ provider: tenantSecrets.provider })
      .from(tenantSecrets)
      .where(and(eq(tenantSecrets.tenantId, tenantId), sql`${tenantSecrets.provider} IN (${META_PROVIDER}, ${GA4_PROVIDER})`)),
  );
  return { metaAccessTokenSet: rows.some((r) => r.provider === META_PROVIDER), ga4ApiSecretSet: rows.some((r) => r.provider === GA4_PROVIDER) };
}

export async function conversionStats(db: Db, tenantId: string): Promise<{ sent: number; failed: number; pending: number; skipped: number }> {
  const res = await withTenant(db, tenantId, (tx) =>
    tx.execute<{ status: string; n: number }>(sql`
      SELECT s AS status, count(*)::int AS n FROM (
        SELECT meta_status AS s FROM order_tracking WHERE tenant_id = ${tenantId} AND created_at > now() - interval '7 days' AND meta_status <> 'skipped'
        UNION ALL
        SELECT ga4_status FROM order_tracking WHERE tenant_id = ${tenantId} AND created_at > now() - interval '7 days' AND ga4_status <> 'skipped'
        UNION ALL
        SELECT meta_status FROM conversion_events WHERE tenant_id = ${tenantId} AND created_at > now() - interval '7 days' AND meta_status <> 'skipped'
      ) x GROUP BY s`),
  );
  const out = { sent: 0, failed: 0, pending: 0, skipped: 0 };
  for (const r of res.rows) if (r.status in out) out[r.status as keyof typeof out] = Number(r.n);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Capturing the order's context (called by the storefront route before the order is placed)
// ---------------------------------------------------------------------------------------------

export interface OrderTrackingRequest {
  cookieHeader?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  sourceUrl?: string | null | undefined;
}

export interface OrderTrackingRow {
  consentAnalytics: boolean;
  consentMarketing: boolean;
  clientIp: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  gaClientId: string | null;
  sourceUrl: string | null;
  metaStatus: "pending" | "skipped";
  ga4Status: "pending" | "skipped";
}

/**
 * Decides what to remember about this order for the server-side APIs. Null (nothing stored) unless a platform is both wanted by the
 * visitor's choice and usable (id configured, credential saved). Pure given its inputs, so it is unit tested without a database.
 */
export function decideOrderTracking(
  cfg: PublicConsentConfig | null,
  creds: { metaAccessTokenSet: boolean; ga4ApiSecretSet: boolean },
  req: OrderTrackingRequest,
): OrderTrackingRow | null {
  if (!cfg) return null;
  const consent = parseConsentCookie(readCookie(req.cookieHeader, "bs_consent"), cfg.rev);
  if (!consent) return null;
  const fbp = readCookie(req.cookieHeader, "_fbp");
  const fbc = readCookie(req.cookieHeader, "_fbc");
  const ga = gaClientIdFromCookie(readCookie(req.cookieHeader, "_ga"));
  const metaWanted = consent.marketing && Boolean(cfg.pixel) && creds.metaAccessTokenSet;
  const ga4Wanted = consent.analytics && Boolean(cfg.ga4) && creds.ga4ApiSecretSet && Boolean(ga);
  if (!metaWanted && !ga4Wanted) return null;
  const cap = (v: string | null | undefined, n: number) => (v ? v.slice(0, n) : null);
  return {
    consentAnalytics: consent.analytics,
    consentMarketing: consent.marketing,
    // Request details only for the platform that needs them.
    clientIp: metaWanted ? cap(req.ip && req.ip !== "unknown" ? req.ip : null, 64) : null,
    userAgent: metaWanted ? cap(req.userAgent, 400) : null,
    fbp: metaWanted && fbp && FB_ID.test(fbp) ? fbp : null,
    fbc: metaWanted && fbc && FB_ID.test(fbc) ? fbc : null,
    gaClientId: ga4Wanted ? ga : null,
    sourceUrl: cap(req.sourceUrl, 500),
    metaStatus: metaWanted ? "pending" : "skipped",
    ga4Status: ga4Wanted ? "pending" : "skipped",
  };
}

// ---------------------------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------------------------

type Status = "pending" | "sent" | "failed" | "skipped";

/**
 * Sends the order's Purchase to each platform that is still pending. Non-retryable failures (a rejected token, a bad pixel id) are
 * recorded and not retried; network errors, 429 and 5xx are recorded as pending and make the job throw so pg-boss retries with backoff.
 * Safe to run twice: a platform that is `sent` is never sent again.
 */
export async function handleAnalyticsConversionJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; orderId: string },
  opts: { fetchFn?: Fetch } = {},
): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch;
  const { tenantId, orderId } = data;

  const loaded = await withTenant(db, tenantId, async (tx) => {
    const [t] = await tx.select().from(schema.orderTracking).where(and(eq(schema.orderTracking.tenantId, tenantId), eq(schema.orderTracking.orderId, orderId))).limit(1);
    if (!t) return null;
    const [o] = await tx.select().from(schema.orders).where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, orderId))).limit(1);
    if (!o) return null;
    const items = await tx.select().from(schema.orderItems).where(and(eq(schema.orderItems.tenantId, tenantId), eq(schema.orderItems.orderId, orderId)));
    const [p] = await tx.select({ c: schema.privacySettings.consentSettings }).from(schema.privacySettings).where(eq(schema.privacySettings.tenantId, tenantId)).limit(1);
    return { t, o, items, consent: normalizeConsentSettings(p?.c) };
  });
  if (!loaded) return;
  const { t, o, items, consent } = loaded;
  if (t.metaStatus !== "pending" && t.ga4Status !== "pending") return;

  const order: ConversionOrder = {
    number: o.number,
    status: o.status,
    currency: o.currency,
    email: o.email ?? null,
    phone: o.phone ?? null,
    grandTotal: Number(o.grandTotal),
    shippingTotal: Number(o.shippingTotal),
    placedAt: o.placedAt,
    items: items.map((i) => ({ variantId: i.variantId, sku: i.sku, productTitle: i.productTitle, variantTitle: i.variantTitle, quantity: i.quantity, unitPrice: Number(i.unitPrice) })),
  };
  const tracking: ConversionTracking = { clientIp: t.clientIp, userAgent: t.userAgent, fbp: t.fbp, fbc: t.fbc, gaClientId: t.gaClientId, sourceUrl: t.sourceUrl };
  const creds = await readConversionCredentials(db, tenantId);

  let meta: { status: Status; detail: string | null } = { status: t.metaStatus as Status, detail: t.metaDetail };
  let ga4: { status: Status; detail: string | null } = { status: t.ga4Status as Status, detail: t.ga4Detail };
  let retry = false;

  if (order.status === "cancelled") {
    if (meta.status === "pending") meta = { status: "skipped", detail: "Order was cancelled" };
    if (ga4.status === "pending") ga4 = { status: "skipped", detail: "Order was cancelled" };
  }

  if (meta.status === "pending") {
    const pixel = consent.integrations.metaPixelId;
    if (!pixel || !creds.metaAccessToken) {
      meta = { status: "skipped", detail: "Pixel ID or access token no longer set" };
    } else {
      const payload = buildMetaPurchasePayload(order, tracking, consent.integrations.metaTestEventCode, creds.metaAccessToken);
      if (!payload) meta = { status: "skipped", detail: "Nothing to send" };
      else {
        const r = await sendMetaPurchase(fetchFn, pixel, payload);
        if (r.ok) meta = { status: "sent", detail: null };
        else if (r.retryable) {
          meta = { status: "pending", detail: r.detail };
          retry = true;
        } else meta = { status: "failed", detail: r.detail };
      }
    }
  }

  if (ga4.status === "pending") {
    const id = consent.integrations.ga4MeasurementId;
    if (!id || !creds.ga4ApiSecret || !tracking.gaClientId) {
      ga4 = { status: "skipped", detail: "Measurement ID, API secret or visitor id missing" };
    } else {
      const payload = buildGa4PurchasePayload(order, tracking.gaClientId);
      if (!payload) ga4 = { status: "skipped", detail: "Nothing to send" };
      else {
        const r = await sendGa4Purchase(fetchFn, id, creds.ga4ApiSecret, payload);
        if (r.ok) ga4 = { status: "sent", detail: null };
        else if (r.retryable) {
          ga4 = { status: "pending", detail: r.detail };
          retry = true;
        } else ga4 = { status: "failed", detail: r.detail };
      }
    }
  }

  const settled = meta.status !== "pending" && ga4.status !== "pending";
  await withTenant(db, tenantId, (tx) =>
    tx
      .update(schema.orderTracking)
      .set({
        metaStatus: meta.status,
        metaDetail: meta.detail,
        ga4Status: ga4.status,
        ga4Detail: ga4.detail,
        attempts: sql`${schema.orderTracking.attempts} + 1`,
        updatedAt: new Date(),
        // Once everything is settled the request details are no longer needed.
        ...(settled ? { clientIp: null, userAgent: null, fbp: null, fbc: null, gaClientId: null } : {}),
      })
      .where(and(eq(schema.orderTracking.tenantId, tenantId), eq(schema.orderTracking.orderId, orderId))),
  );
  log.info({ orderId, meta: meta.status, ga4: ga4.status }, "analytics.conversion processed");
  if (retry) throw new Error("Conversion API call failed; retrying");
}

/** Hourly: give up on stale pending events, clear their request details, and delete old rows. */
export async function pruneOrderTracking(db: Db, tenantId: string): Promise<{ gaveUp: number; deleted: number }> {
  return withTenant(db, tenantId, async (tx) => {
    const gave = await tx
      .update(schema.orderTracking)
      .set({
        metaStatus: sql`CASE WHEN meta_status = 'pending' THEN 'failed' ELSE meta_status END`,
        metaDetail: sql`CASE WHEN meta_status = 'pending' THEN 'Gave up after repeated errors' ELSE meta_detail END`,
        ga4Status: sql`CASE WHEN ga4_status = 'pending' THEN 'failed' ELSE ga4_status END`,
        ga4Detail: sql`CASE WHEN ga4_status = 'pending' THEN 'Gave up after repeated errors' ELSE ga4_detail END`,
        clientIp: null,
        userAgent: null,
        fbp: null,
        fbc: null,
        gaClientId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.orderTracking.tenantId, tenantId),
          lt(schema.orderTracking.createdAt, sql`now() - make_interval(hours => ${CONVERSION_GIVE_UP_HOURS})`),
          sql`(meta_status = 'pending' OR ga4_status = 'pending' OR client_ip IS NOT NULL OR user_agent IS NOT NULL OR fbp IS NOT NULL OR fbc IS NOT NULL OR ga_client_id IS NOT NULL)`,
        ),
      )
      .returning({ id: schema.orderTracking.id });
    const del = await tx
      .delete(schema.orderTracking)
      .where(and(eq(schema.orderTracking.tenantId, tenantId), lt(schema.orderTracking.createdAt, sql`now() - make_interval(days => ${ORDER_TRACKING_RETENTION_DAYS})`)))
      .returning({ id: schema.orderTracking.id });
    // Add to cart and begin checkout events (slice 5c): same give-up rule, deleted after 7 days.
    const gaveEvents = await tx
      .update(schema.conversionEvents)
      .set({
        metaStatus: sql`CASE WHEN meta_status = 'pending' THEN 'failed' ELSE meta_status END`,
        metaDetail: sql`CASE WHEN meta_status = 'pending' THEN 'Gave up after repeated errors' ELSE meta_detail END`,
        clientIp: null,
        userAgent: null,
        fbp: null,
        fbc: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.conversionEvents.tenantId, tenantId),
          lt(schema.conversionEvents.createdAt, sql`now() - make_interval(hours => ${CONVERSION_GIVE_UP_HOURS})`),
          sql`(meta_status = 'pending' OR client_ip IS NOT NULL OR user_agent IS NOT NULL OR fbp IS NOT NULL OR fbc IS NOT NULL)`,
        ),
      )
      .returning({ id: schema.conversionEvents.id });
    const delEvents = await tx
      .delete(schema.conversionEvents)
      .where(and(eq(schema.conversionEvents.tenantId, tenantId), lt(schema.conversionEvents.createdAt, sql`now() - make_interval(days => ${TRACKING_EVENT_RETENTION_DAYS})`)))
      .returning({ id: schema.conversionEvents.id });
    return { gaveUp: gave.length + gaveEvents.length, deleted: del.length + delEvents.length };
  });
}

// ---------------------------------------------------------------------------------------------
// Add to cart and begin checkout, sent from the server to Meta only (slice 5c)
// ---------------------------------------------------------------------------------------------

export type ServerEventName = "AddToCart" | "InitiateCheckout";

export interface ServerEventRow {
  clientIp: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  sourceUrl: string | null;
}

/**
 * Whether to send this visitor's AddToCart or InitiateCheckout to Meta from the server. Only with marketing consent of the current
 * banner revision, a configured Pixel ID and a saved access token. Meta only: GA4 cannot de-duplicate these against the browser
 * event, so sending both would double count. Pure, so it is unit tested without a database.
 */
export function decideEventTracking(
  cfg: PublicConsentConfig | null,
  creds: { metaAccessTokenSet: boolean },
  req: OrderTrackingRequest,
): ServerEventRow | null {
  if (!cfg || !cfg.pixel || !creds.metaAccessTokenSet) return null;
  const consent = parseConsentCookie(readCookie(req.cookieHeader, "bs_consent"), cfg.rev);
  if (!consent?.marketing) return null;
  const fbp = readCookie(req.cookieHeader, "_fbp");
  const fbc = readCookie(req.cookieHeader, "_fbc");
  const cap = (v: string | null | undefined, n: number) => (v ? v.slice(0, n) : null);
  return {
    clientIp: cap(req.ip && req.ip !== "unknown" ? req.ip : null, 64),
    userAgent: cap(req.userAgent, 400),
    fbp: fbp && FB_ID.test(fbp) ? fbp : null,
    fbc: fbc && FB_ID.test(fbc) ? fbc : null,
    sourceUrl: cap(req.sourceUrl, 500),
  };
}

export function buildMetaEventPayload(
  ev: { name: ServerEventName; eventId: string; eventTime: Date; currency: string; value: number; items: Array<{ id: string; quantity: number; price: number }> },
  t: ServerEventRow,
  testEventCode: string | null,
  token: string,
): MetaPayload {
  const userData: Record<string, unknown> = {};
  if (t.clientIp) userData["client_ip_address"] = t.clientIp;
  if (t.userAgent) userData["client_user_agent"] = t.userAgent;
  if (t.fbp) userData["fbp"] = t.fbp;
  if (t.fbc) userData["fbc"] = t.fbc;
  return {
    access_token: token,
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
    data: [
      {
        event_name: ev.name,
        // The browser sends the same id as `eventID`, so Meta counts the event once.
        event_id: ev.eventId,
        event_time: Math.floor(ev.eventTime.getTime() / 1000),
        action_source: "website",
        ...(t.sourceUrl ? { event_source_url: t.sourceUrl } : {}),
        user_data: userData,
        custom_data: {
          currency: ev.currency,
          value: ev.value,
          content_type: "product",
          content_ids: ev.items.map((i) => i.id),
          contents: ev.items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.price })),
          num_items: ev.items.reduce((n, i) => n + i.quantity, 0),
        },
      },
    ],
  };
}
