import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { receiveWebhook } from "@bs/domain";
import { server } from "@/server/runtime.ts";

export async function POST(
  req: Request,
  props: { params: Promise<{ provider: string }> },
) {
  try {
    const params = await props.params;
    const provider = params.provider.toLowerCase();

    const rawBody = await req.text();
    let parsed: Record<string, unknown>;
    try {
      const json = JSON.parse(rawBody);
      parsed = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { rt } = server();

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

    // Extract tenantId if present
    const url = new URL(req.url);
    const tenantId =
      url.searchParams.get("tenantId") ||
      req.headers.get("x-tenant-id") ||
      (typeof parsed.tenant_id === "string" && parsed.tenant_id) ||
      (typeof paymentNotes?.tenant_id === "string" && paymentNotes.tenant_id) ||
      (typeof orderNotes?.tenant_id === "string" && orderNotes.tenant_id) ||
      undefined;

    const signature =
      req.headers.get("x-razorpay-signature") ||
      req.headers.get("x-webhook-signature") ||
      "";

    const signatureValid = Boolean(signature || process.env.NODE_ENV !== "production");

    // Ingest into inbox (decoupled, returns immediately)
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
