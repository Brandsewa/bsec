import { NextResponse, type NextRequest } from "next/server";
import { evaluateStorefrontAccess } from "@bs/domain";
import { server } from "@/server/runtime.ts";

export async function GET(request: NextRequest) {
  const host =
    request.nextUrl.searchParams.get("host") ??
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "localhost";

  const cookiesRecord: Record<string, string> = {};
  for (const cookie of request.cookies.getAll()) {
    cookiesRecord[cookie.name] = cookie.value;
  }

  try {
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, {
      headers: request.headers,
      cookies: cookiesRecord,
      searchParams: request.nextUrl.searchParams,
    });
    return NextResponse.json(access);
  } catch (error) {
    return NextResponse.json({
      allowed: true,
      httpStatus: 200,
      mode: "live",
      error: error instanceof Error ? error.message : "Internal error",
    });
  }
}
