import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { evaluateStorefrontAccess } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getCachedBrandAssets, getCachedCollectionsArchive, getCachedStoreName } from "@/server/cached-storefront.ts";
import { withShareImage } from "@/lib/share-image.ts";
import { blocksHaveH1 } from "@/lib/has-h1.ts";
import { archiveCopy, archiveItems, archiveJsonLd, archiveMetadata } from "@/lib/archive-meta.ts";
import { JsonLd } from "@/components/blog/JsonLd.tsx";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { getMarketContext } from "@/server/market.ts";

const FALLBACK = { title: "Collections", description: "Browse every collection in the store." };

// The words come from the theme's archive template (its page SEO, else the grid's title and subtitle), so the merchant edits them
// in the theme editor; see lib/archive-meta.ts. The root layout sets robots for the store.
export async function generateMetadata(): Promise<Metadata> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const access = await evaluateStorefrontAccess(server().rt, host, { headers: h });
    if (!access.tenantId) return { title: FALLBACK.title, description: FALLBACK.description };
    const [storeName, marketCtx, assets, archive] = await Promise.all([
      getCachedStoreName(access.tenantId),
      getMarketContext(access.tenantId),
      getCachedBrandAssets(access.tenantId).catch(() => null),
      getCachedCollectionsArchive(access.tenantId),
    ]);
    const pfx = marketCtx.prefix ? (marketCtx.prefix.startsWith("/") ? marketCtx.prefix : `/${marketCtx.prefix}`) : "";
    const copy = archiveCopy({ seo: archive.seo, blocks: archive.blocks, fallback: FALLBACK });
    return withShareImage(archiveMetadata({ copy, storeName, host, prefix: pfx, path: "/collections" }), assets?.shareImage);
  } catch {
    return { title: FALLBACK.title, description: FALLBACK.description };
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
  const copy = archiveCopy({ seo: archive.seo, blocks: archive.blocks, fallback: FALLBACK });
  const pfx = marketCtx.prefix ? (marketCtx.prefix.startsWith("/") ? marketCtx.prefix : `/${marketCtx.prefix}`) : "";
  return (
    <div className="bs-skin">
      <JsonLd data={archiveJsonLd({ copy, host, prefix: pfx, path: "/collections", itemPath: "/collections", items: archiveItems(archive.renderData) })} />
      {blocksHaveH1(archive.blocks) ? null : <h1 className="sr-only">{copy.title}</h1>}
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
