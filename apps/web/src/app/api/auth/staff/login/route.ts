import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminLoginLimit, RateLimitExceededError } from "@bs/domain";
import { server } from "@/server/runtime.ts";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Staff/Admin Login Route with strict Rate Limiting (PLAN §14 / M7).
 * Per-IP: 10 attempts / 15m.
 * Per-Email: 5 attempts / 15m.
 */
export async function POST(req: Request) {
  try {
    const { rt } = server();

    const clientIp =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "127.0.0.1";

    const json = await req.json().catch(() => ({}));
    const parsed = LoginSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid credentials format", details: parsed.error.issues }, { status: 400 });
    }

    try {
      await checkAdminLoginLimit(rt._db.db, {
        ip: clientIp,
        email: parsed.data.email,
      });
    } catch (err: unknown) {
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json(
          { error: err.message },
          {
            status: 429,
            headers: {
              "Retry-After": String(err.retryAfter),
            },
          },
        );
      }
      throw err;
    }

    // Rate limit passed. Note: In current M7 state, full Better Auth staff flow is finalized in M8/M9.
    return NextResponse.json({
      success: true,
      message: "Credentials accepted under rate limit constraints",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Login error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
