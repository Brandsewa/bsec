import { NextResponse } from "next/server";
import { z } from "zod";
import { completeGoogleSetupVerification, issueSetupNonce, readGoogleSetupTicket } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { readAuthSettings } from "@/server/auth.ts";
import { getRequestHeaders, sameOrigin } from "@/server/customer-session.ts";

const NO_STORE = { "Cache-Control": "no-store" };

/** The store-setup test page asks for the nonce its Google prompt must carry. The signed ticket is the only credential. */
export async function GET(req: Request) {
  const secret = readAuthSettings()?.secret;
  const ticket = new URL(req.url).searchParams.get("t");
  if (!secret || !ticket) return NextResponse.json({ error: "Invalid link" }, { status: 400, headers: NO_STORE });
  const parsed = readGoogleSetupTicket(secret, ticket);
  if (!parsed) return NextResponse.json({ error: "This test link expired. Start the test again from Store Admin." }, { status: 400, headers: NO_STORE });
  const h = await getRequestHeaders(req);
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost").split(":")[0]!.toLowerCase();
  return NextResponse.json(
    { clientId: parsed.clientId, nonce: issueSetupNonce(secret, parsed.tenantId, host) },
    { headers: NO_STORE },
  );
}

const Body = z.object({ ticket: z.string().min(10), idToken: z.string().min(20), nonce: z.string().min(10) });

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const secret = readAuthSettings()?.secret;
    if (!secret) return NextResponse.json({ error: "Google sign-in is not available." }, { status: 503, headers: NO_STORE });
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    await completeGoogleSetupVerification(server().rt._db.db, { ...parsed.data, host }, { secret });
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The test failed" }, { status: 400, headers: NO_STORE });
  }
}
