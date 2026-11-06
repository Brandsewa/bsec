import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { getPublicPlatformBrand } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/**
 * Default share image for the platform's own pages (docs/PLATFORM-BRANDING-PLAN.md phase 3): brand colours, the
 * dark logo (the card is dark), name and tagline. Server-rendered PNG, so nothing is added to any page's JS.
 */
export async function GET() {
  // Read the brand per request: without this Next prerenders the built-in fallback at build time and never updates.
  await connection();
  // server() throws when no database is configured (e.g. at build time): fall back to the built-in look.
  const brand = await Promise.resolve()
    .then(() => getPublicPlatformBrand(server().rt))
    .catch(() => null);
  const t = brand?.tokens;
  const background = t?.color.secondary ?? "#1c1f1d";
  const accent = t?.color.primary ?? "#1f6f4a";
  const name = t?.identity.name || "BCOM";
  const tagline = t?.identity.tagline || "Launch your online store in 10 minutes.";
  const logo = t ? (t.logo.dark.full ?? t.logo.dark.icon ?? t.logo.light.full ?? t.logo.light.icon) : null;
  const logoUrl = logo?.url.startsWith("https://") ? logo.url : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background, color: "#ffffff" }}>
        <div style={{ display: "flex", alignItems: "center", height: 96 }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img>, not next/image
            <img src={logoUrl} alt="" height={96} style={{ height: 96, objectFit: "contain" }} />
          ) : (
            <div style={{ fontSize: 64, fontWeight: 700 }}>{name}</div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, maxWidth: 960 }}>{tagline}</div>
          <div style={{ marginTop: 32, height: 8, width: 160, background: accent, borderRadius: 4 }} />
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
