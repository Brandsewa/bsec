import { NextResponse } from "next/server";
import { checkStorefrontRateLimit, createPrivacyRequestPublic } from "@bs/domain";
import { errorResponse, resolveStore, sameOrigin } from "@/server/customer-session.ts";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const store = await resolveStore(req);
    if (!store) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    await checkStorefrontRateLimit(store.rt._db.db, store.tenantId);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { email, kind, details } = body as { email?: unknown; kind?: unknown; details?: unknown };

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
    }

    const validKinds = ["access", "correction", "erasure", "grievance", "withdraw_consent"];
    if (!kind || typeof kind !== "string" || !validKinds.includes(kind)) {
      return NextResponse.json({ error: "Invalid privacy request kind" }, { status: 400 });
    }

    const origin = req.headers.get("origin") || req.headers.get("referer");
    const baseUrl = origin ? new URL(origin).origin : undefined;

    const res = await createPrivacyRequestPublic(store.rt._db.db, store.tenantId, {
      email,
      kind: kind as "access" | "correction" | "erasure" | "grievance" | "withdraw_consent",
      details: typeof details === "string" ? details : undefined,
      baseUrl,
    });

    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err, "Could not submit privacy request right now");
  }
}
