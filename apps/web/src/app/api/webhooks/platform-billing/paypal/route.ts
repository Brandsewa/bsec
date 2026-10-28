import { NextResponse } from "next/server";
import { handlePayPalBillingWebhook, SaasNotConfiguredError } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/** PayPal subscription and order events for the platform's global plan billing (ADR-040 WP-5). */
export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const headers: Record<string, string | string[] | undefined> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const { rt } = server();
    const result = await handlePayPalBillingWebhook(rt, { rawBody, headers });
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof SaasNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
    const error = err as { statusCode?: number; message?: string };
    return NextResponse.json({ error: error.message || "Failed to process platform billing webhook" }, { status: error.statusCode || 400 });
  }
}
