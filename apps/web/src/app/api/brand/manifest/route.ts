import { connection } from "next/server";
import { getPublicPlatformBrand } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/** Web app manifest for the platform's own site, from the brand (theme colour, name, icons). docs/PLATFORM-BRANDING-PLAN.md phase 3. */
export async function GET() {
  // Read the brand per request: without this Next prerenders the built-in fallback at build time and never updates.
  await connection();
  // server() throws when no database is configured (e.g. at build time): fall back to the built-in look.
  const brand = await Promise.resolve()
    .then(() => getPublicPlatformBrand(server().rt))
    .catch(() => null);
  const t = brand?.tokens;
  const name = t?.identity.name || "BCOM";
  const icon = t ? (t.favicon ?? t.logo.light.icon ?? t.logo.dark.icon) : null;
  const manifest = {
    name,
    short_name: name.slice(0, 12),
    description: t?.identity.tagline || "Launch your online store in 10 minutes.",
    start_url: "/",
    display: "standalone",
    theme_color: t?.color.primary ?? "#1f6f4a",
    background_color: "#ffffff",
    icons: icon ? [{ src: icon.url, sizes: "any", purpose: "any" }] : [],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
  });
}
