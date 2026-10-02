import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, finalizeReturnPhoto, checkStorefrontRateLimit, RateLimitExceededError } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders } from "../../../../../cart/route.ts";

const Body = z.object({
  mediaId: z.string().uuid(),
  storageKey: z.string().min(1),
  filename: z.string().trim().min(1).max(255),
  bytes: z.number().int().min(1).max(5 * 1024 * 1024),
  mime: z.string().trim().min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: _token } = await params;
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

    const result = await finalizeReturnPhoto(
      rt,
      {
        tenantId: access.tenantId,
        storeStatus: access.mode ?? "live",
        actor: { type: "system" as const },
        roles: [],
        permissions: [],
        requestId: crypto.randomUUID(),
      },
      parsed.data,
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : "Could not finalize photo";
    const message = raw.replace(/^(Bad Request|Not Found|Conflict|Precondition):\s*/, "");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
