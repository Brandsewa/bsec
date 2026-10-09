import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  receiveWebhook,
  resolveWebhookTenant,
  getTenantPaymentSecrets,
  ShiprocketProvider,
  checkWebhookRateLimit,
  RateLimitExceededError,
  getClientIp,
} from "@bs/domain";
import { RazorpayProvider, CODProvider, StripeProvider } from "@bs/payments";
import { server } from "@/server/runtime.ts";

export async function POST(
  req: Request,
  props: { params: Promise<{ provider: string }> },
) {
  try {
    const params = await props.params;
    const provider = params.provider.toLowerCase();

    const { rt } = server();

    // 1. IP extraction using reverse proxy hop parsing (PLAN §14 / M7)
    const clientIp = getClientIp(req.headers);

    const rawBody = await req.text();
    let parsed: Record<string, unknown>;
    try {
      const json = JSON.parse(rawBody);
      parsed = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const payloadObj = parsed.payload as Record<string, unknown> | undefined;
    const paymentObj = payloadObj?.payment as Record<string, unknown> | undefined;
    const paymentEntity = paymentObj?.entity as Record<string, unknown> | undefined;
    const paymentNotes = paymentEntity?.notes as Record<string, unknown> | undefined;
    const orderObj = payloadObj?.order as Record<string, unknown> | undefined;
    const orderEntity = orderObj?.entity as Record<string, unknown> | undefined;
    const orderNotes = orderEntity?.notes as Record<string, unknown> | undefined;

    // Extract eventId from provider payload / headers
    const eventId =
      (typeof parsed.event_id === "string" && parsed.event_id) ||
      (typeof parsed.id === "string" && parsed.id) ||
      req.headers.get("x-razorpay-event-id") ||
      (typeof paymentEntity?.id === "string" && paymentEntity.id) ||
      `evt_${randomUUID()}`;

    // Extract claimed tenantId if present
    const url = new URL(req.url);
    const claimedTenantId =
      url.searchParams.get("tenantId") ||
      req.headers.get("x-tenant-id") ||
      (typeof parsed.tenant_id === "string" && parsed.tenant_id) ||
      (typeof paymentNotes?.tenant_id === "string" && paymentNotes.tenant_id) ||
      (typeof orderNotes?.tenant_id === "string" && orderNotes.tenant_id) ||
      undefined;

    const providerOrderId =
      (typeof paymentEntity?.order_id === "string" && paymentEntity.order_id) ||
      (typeof orderEntity?.id === "string" && orderEntity.id) ||
      (typeof parsed.order_id === "string" && parsed.order_id) ||
      undefined;

    const providerPaymentId =
      (typeof paymentEntity?.id === "string" && paymentEntity.id) ||
      (typeof parsed.payment_id === "string" && parsed.payment_id) ||
      undefined;

    const shipmentId =
      (typeof parsed.shipment_id === "string" && parsed.shipment_id) ||
      (typeof parsed.shipmentId === "string" && parsed.shipmentId) ||
      undefined;

    const awb =
      (typeof parsed.awb === "string" && parsed.awb) ||
      (typeof parsed.awb_code === "string" && parsed.awb_code) ||
      undefined;

    const orderId =
      (typeof orderNotes?.order_id === "string" && orderNotes.order_id) ||
      (typeof paymentNotes?.order_id === "string" && paymentNotes.order_id) ||
      (typeof parsed.order_id === "string" && parsed.order_id) ||
      undefined;

    // 2. Tenant identity verification (M7 security boundary)
    // Tenant identity is established by the per-tenant webhook secret.
    // The claimed tenantId selects which secret to verify against; the HMAC signature proves authenticity.
    let tenantId: string | undefined;
    try {
      const resolved = await resolveWebhookTenant(rt._db.db, {
        provider,
        claimedTenantId,
        providerOrderId,
        providerPaymentId,
        shipmentId,
        awb,
        orderId,
      });
      tenantId = resolved.tenantId;
    } catch (err: unknown) {
      // Enforce rate limit on unverified / failed tenant requests before returning 400
      try {
        await checkWebhookRateLimit(rt._db.db, { ip: clientIp, provider });
      } catch (rateErr: unknown) {
        if (rateErr instanceof RateLimitExceededError) {
          return NextResponse.json(
            { error: rateErr.message },
            { status: 429, headers: { "Retry-After": String(rateErr.retryAfter) } },
          );
        }
      }
      const msg = err instanceof Error ? err.message : "Tenant verification failed";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    if (!tenantId) {
      return NextResponse.json({ error: "Cannot determine tenant for webhook event" }, { status: 400 });
    }

    // 3. Enforce real signature verification using decrypted provider secrets (PLAN §11.4)
    const headersRecord: Record<string, string | string[] | undefined> = {};
    req.headers.forEach((val, key) => {
      headersRecord[key] = val;
    });

    let signatureValid = false;
    if (provider === "razorpay") {
      const creds = await getTenantPaymentSecrets(rt._db.db, tenantId, "razorpay");
      const razorpayProvider = new RazorpayProvider(creds);
      const verified = await razorpayProvider.verifyWebhook(headersRecord, rawBody);
      signatureValid = verified.isValid;
    } else if (provider === "stripe") {
      // Stripe signs with the store's own whsec_ signing secret (Stripe-Signature header, 5 minute tolerance).
      const creds = await getTenantPaymentSecrets(rt._db.db, tenantId, "stripe");
      const stripeProvider = new StripeProvider({ webhookSecret: creds.webhookSecret });
      const verified = await stripeProvider.verifyWebhook(headersRecord, rawBody);
      signatureValid = verified.isValid;
    } else if (provider === "cod") {
      const creds = await getTenantPaymentSecrets(rt._db.db, tenantId, "cod");
      const codProvider = new CODProvider(creds);
      const verified = await codProvider.verifyWebhook(headersRecord, rawBody);
      signatureValid = verified.isValid;
    } else if (provider === "shiprocket") {
      const creds = await getTenantPaymentSecrets(rt._db.db, tenantId, "shiprocket");
      const shiprocketProvider = new ShiprocketProvider({ credentials: creds });
      const verified = await shiprocketProvider.verifyWebhook(headersRecord, rawBody);
      signatureValid = verified.isValid;
    } else {
      signatureValid = false;
    }

    // 4. Rate Limiting Policy (PLAN §14 / M7):
    // A webhook carrying a valid signature must NEVER be rate-limited into failure.
    // Rate-limiting applies strictly to unverified / spoofed requests per provider and source IP.
    if (!signatureValid) {
      try {
        await checkWebhookRateLimit(rt._db.db, { ip: clientIp, provider });
      } catch (err: unknown) {
        if (err instanceof RateLimitExceededError) {
          return NextResponse.json(
            { error: err.message },
            {
              status: 429,
              headers: {
                "Retry-After": String(err.retryAfter),
              },
            },
          );
        }
        throw err;
      }
    }

    // 5. Ingest into inbox (decoupled, returns immediately)
    const result = await receiveWebhook(
      rt._db.db,
      {
        provider,
        eventId,
        tenantId,
        signatureValid,
        rawPayload: parsed,
      },
      rt._jobs,
    );

    return NextResponse.json({ received: true, duplicate: result.duplicate }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error processing webhook";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
