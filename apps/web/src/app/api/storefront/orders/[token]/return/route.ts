import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, requestReturnByToken, checkStorefrontRateLimit, RateLimitExceededError } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders } from "../../../cart/route.ts";

const Body = z.object({
  reason: z.string().trim().min(3, "Please tell us why you want to return this").max(500),
  resolution: z.enum(["refund", "replacement"]).optional(),
  exchangeRequest: z.string().trim().max(1000).optional(),
  customerComment: z.string().trim().max(1000).optional(),
  photos: z.array(z.string().uuid()).max(5).optional(),
  items: z.array(z.object({ orderItemId: z.string().uuid(), quantity: z.number().int().min(1).max(999) })).min(1, "Choose at least one item to return"),
});

/** A shopper asks to return items from their order; the order link in the URL is their proof of ownership. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId) return NextResponse.json({ error: "Store not found" }, { status: 404 });

    try {
      await checkStorefrontRateLimit(rt._db.db, access.tenantId);
    } catch (err: unknown) {
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json({ error: err.message }, { status: 429, headers: { "Retry-After": String(err.retryAfter) } });
      }
      throw err;
    }

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

    const result = await requestReturnByToken(
      rt,
      {
        tenantId: access.tenantId,
        storeStatus: access.mode ?? "live",
        actor: { type: "system" as const },
        roles: [],
        permissions: [],
        requestId: crypto.randomUUID(),
      },
      { token, ...parsed.data },
    );
    return NextResponse.json({ number: result.number });
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : "Could not send your return request";
    const message = raw.replace(/^(Bad Request|Not Found|Conflict|Precondition):\s*/, "");
    const known = /^(Bad Request|Not Found|Conflict|Precondition):/.test(raw);
    return NextResponse.json({ error: known ? message : "Could not send your return request" }, { status: known ? 400 : 500 });
  }
}
