import { NextResponse } from "next/server";
import { handlePlatformBillingWebhook } from "@bs/domain";
import { server } from "@/server/runtime.ts";

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing x-razorpay-signature header" },
        { status: 400 },
      );
    }

    const { rt } = server();

    const result = await handlePlatformBillingWebhook(rt, {
      rawBody,
      signature,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };
    const status = error.statusCode || 400;
    return NextResponse.json(
      { error: error.message || "Failed to process platform billing webhook" },
      { status },
    );
  }
}
