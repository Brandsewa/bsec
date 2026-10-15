import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { evaluateStorefrontAccess } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getCachedCollectionsArchive } from "@/server/cached-storefront.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const access = await evaluateStorefrontAccess(server().rt, host, { headers: h }).catch(() => null);
  return {
    title: "Collections",
    description: "Browse every collection in the store.",
    alternates: { canonical: `https://${host}/collections` },
    ...(access?.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

/** Collection Archive: every published collection. Layout comes from the theme's archive template when it has one. */
export default async function CollectionsArchivePage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const access = await evaluateStorefrontAccess(server().rt, host, { headers: h });
  if (!access.tenantId) return null;

  const archive = await getCachedCollectionsArchive(access.tenantId);
  return (
    <div className="bs-skin">
      <BlockRenderer blocks={archive.blocks} renderData={archive.renderData} />
    </div>
  );
}
