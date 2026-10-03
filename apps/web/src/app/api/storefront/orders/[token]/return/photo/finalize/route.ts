import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluateStorefrontAccess,
  finalizeReturnPhoto,
  resolveOrderIdFromToken,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getRequestHeaders } from "../../../../../cart/route.ts";

const Body = z.object({
  mediaId: z.string().uuid(),
  storageKey: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId) return NextResponse.json({ error: "Store not found" }, { status: 404 });

    const orderId = await resolveOrderIdFromToken(rt._db.db, access.tenantId, token);
    if (!orderId) {
      return NextResponse.json({ error: "Invalid or expired order link" }, { status: 404 });
    }

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }

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
      {
        orderId,
        mediaId: parsed.data.mediaId,
        storageKey: parsed.data.storageKey,
      },
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : "Could not finalize photo";
    const message = raw.replace(/^(Bad Request|Not Found|Conflict|Precondition):\s*/, "");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
