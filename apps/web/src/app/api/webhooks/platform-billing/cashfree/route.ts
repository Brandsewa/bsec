import { NextResponse } from "next/server";
import { handleCashfreeBillingWebhook, SaasNotConfiguredError } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/** Cashfree subscription events for the platform's own plan billing (ADR-037). Signed over timestamp + raw body. */
export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-webhook-signature");
    const timestamp = req.headers.get("x-webhook-timestamp");

    if (!signature || !timestamp) {
      return NextResponse.json({ error: "Missing x-webhook-signature or x-webhook-timestamp header" }, { status: 400 });
    }

    const { rt } = server();
    const result = await handleCashfreeBillingWebhook(rt, { rawBody, signature, timestamp });
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof SaasNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
    const error = err as { statusCode?: number; message?: string };
    return NextResponse.json({ error: error.message || "Failed to process platform billing webhook" }, { status: error.statusCode || 400 });
  }
}
