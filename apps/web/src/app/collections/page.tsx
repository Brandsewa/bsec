import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { evaluateStorefrontAccess } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getCachedCollectionsArchive, getCachedStoreName } from "@/server/cached-storefront.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { getMarketContext } from "@/server/market.ts";

// The root layout sets robots for the store; this adds the store name to the title and a canonical URL.
export async function generateMetadata(): Promise<Metadata> {
  const fallback: Metadata = { title: "Collections", description: "Browse every collection in the store." };
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const access = await evaluateStorefrontAccess(server().rt, host, { headers: h });
    if (!access.tenantId) return fallback;
    const [storeName, marketCtx] = await Promise.all([getCachedStoreName(access.tenantId), getMarketContext(access.tenantId)]);
    const pfx = marketCtx.prefix ? (marketCtx.prefix.startsWith("/") ? marketCtx.prefix : `/${marketCtx.prefix}`) : "";
    const title = `Collections | ${storeName}`;
    const description = `Browse every collection at ${storeName}.`;
    const url = `https://${host}${pfx}/collections`;
    return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, siteName: storeName } };
  } catch {
    return fallback;
  }
}

/** Collection Archive: every published collection. Layout comes from the theme's archive template when it has one. */
export default async function CollectionsArchivePage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const access = await evaluateStorefrontAccess(server().rt, host, { headers: h });
  if (!access.tenantId) return null;

  const marketCtx = await getMarketContext(access.tenantId);
  const archive = await getCachedCollectionsArchive(access.tenantId);
  return (
    <div className="bs-skin">
      <BlockRenderer
        blocks={archive.blocks}
        renderData={archive.renderData}
        context={{
          currency: marketCtx.currency,
          locale: marketCtx.locale,
        }}
      />
    </div>
  );
}
