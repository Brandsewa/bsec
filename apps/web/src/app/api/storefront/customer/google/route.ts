import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateStorefrontAccess, getClientIp, getStorefrontGoogleConfig, RateLimitExceededError, signInWithGoogle } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { readAuthSettings } from "@/server/auth.ts";
import { currentCustomer, customerCookie, getRequestHeaders, sameOrigin } from "@/server/customer-session.ts";

const NO_STORE = { "Cache-Control": "no-store" };

/** Whether Google sign-in is on for THIS host (a live custom domain of the store) and the nonce to bind a sign-in to. */
export async function GET(req: Request) {
  try {
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const secret = readAuthSettings()?.secret;
    if (!secret) return NextResponse.json({ enabled: false }, { headers: NO_STORE });
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId) return NextResponse.json({ enabled: false }, { headers: NO_STORE });
    // A visitor who is already signed in needs neither the button nor One Tap.
    if (await currentCustomer({ rt, tenantId: access.tenantId, mode: access.mode ?? "live" })) {
      return NextResponse.json({ enabled: false }, { headers: NO_STORE });
    }
    const cfg = await getStorefrontGoogleConfig(rt._db.db, secret, access.tenantId, host);
    return NextResponse.json(cfg, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  }
}

const SignInSchema = z.object({ idToken: z.string().min(20), nonce: z.string().min(10) });

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const secret = readAuthSettings()?.secret;
    if (!secret) return NextResponse.json({ error: "Google sign-in is not available." }, { status: 503, headers: NO_STORE });

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId) return NextResponse.json({ error: "Store not found" }, { status: 404 });

    const parsed = SignInSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });

    const result = await signInWithGoogle(
      rt._db.db,
      access.tenantId,
      { ...parsed.data, host },
      { secret },
      { ip: getClientIp(req.headers), userAgent: h.get("user-agent") ?? undefined },
    );
    const response = NextResponse.json({ success: true, customer: result.customer }, { headers: NO_STORE });
    response.cookies.set(customerCookie(result.token));
    return response;
  } catch (err: unknown) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { ...NO_STORE, "Retry-After": String(err.retryAfter) } },
      );
    }
    const message = err instanceof Error ? err.message : "Google sign-in failed";
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE });
  }
}
