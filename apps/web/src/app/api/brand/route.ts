import { getPublicPlatformBrand } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/** Public platform brand (logos, favicon, colours, buttons) for the dashboards and sign-in pages. docs/PLATFORM-BRANDING-PLAN.md. */
export async function GET() {
  try {
    const brand = await getPublicPlatformBrand(server().rt);
    return Response.json(brand, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600", "Access-Control-Allow-Origin": "*" } });
  } catch {
    return Response.json({ explicit: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
