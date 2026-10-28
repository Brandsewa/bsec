import { NextResponse } from "next/server";
import { evaluateStorefrontAccess, listStorefrontMarkets } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { MARKET_COOKIE } from "@/lib/market-constants.ts";

/**
 * The shopper picked a market (switcher, or the suggestion banner). Saves the choice in a strictly necessary cookie and goes
 * to the same page under that market's URL prefix. A plain GET link, so it works without JavaScript.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const handle = url.searchParams.get("handle") ?? "";
  const rawNext = url.searchParams.get("next") ?? "/";
  // Only same-site paths: "//evil.example" and "https://..." never redirect off the store.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.includes("\\") ? rawNext : "/";

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: req.headers });
  if (!access.tenantId) return NextResponse.redirect(new URL("/", req.url), 302);

  const markets = await listStorefrontMarkets(rt, access.tenantId);
  const market = markets.find((m) => m.handle === handle);
  const target = market ? `${market.pathPrefix ?? ""}${next}` : next;
  const res = NextResponse.redirect(new URL(target, req.url), 302);
  if (market) {
    res.cookies.set({ name: MARKET_COOKIE, value: market.handle, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 90 });
  }
  return res;
}
