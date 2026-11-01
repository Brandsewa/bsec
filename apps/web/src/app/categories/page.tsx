import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { evaluateStorefrontAccess } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getCachedCategoriesArchive } from "@/server/cached-storefront.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { getMarketContext } from "@/server/market.ts";

// Static on purpose: the root layout already sets robots and the canonical host for the store.
export const metadata: Metadata = {
  title: "Shop by category",
  description: "Browse every product category in the store.",
};

/** Category Archive: every active category. Layout comes from the same theme template as the Collection Archive. */
export default async function CategoriesArchivePage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const access = await evaluateStorefrontAccess(server().rt, host, { headers: h });
  if (!access.tenantId) return null;

  const marketCtx = await getMarketContext(access.tenantId);
  const archive = await getCachedCategoriesArchive(access.tenantId);
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
