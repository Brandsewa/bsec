import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getThemePreview } from "@bs/domain";
import { buildSampleRenderData, computeThemeTokens, googleFontsHref, THEME_PAGE_LABELS, type BlockInstance } from "@bs/blocks";
import { server } from "@/server/runtime.ts";
import { isPlatformMarketingHost } from "@/server/hosts.ts";
import { sampleCart, sampleCollection, sampleProductDetail } from "@/server/preview-samples.ts";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { ThemeChrome } from "@/components/storefront/ThemeChrome.tsx";
import { CollectionListingSection } from "@/components/catalog/CollectionListingSection.tsx";
import { ProductDetailSection } from "@/components/product/ProductDetailSection.tsx";
import { CartView } from "@/components/cart/CartView.tsx";

/**
 * A theme preview: a snapshot of a theme's draft (from Super Admin) drawn like a storefront, with sample
 * products, a sample collection and a sample cart. It is served on the platform's marketing host only, is
 * never indexed, and the link expires. Nothing on it talks to a real store.
 */
export const metadata: Metadata = { title: "Theme preview", robots: { index: false, follow: false } };

const ORDER = ["home", "collection", "product", "cart"];

/** Whole hours until the link expires (at least 1). */
function hoursUntil(iso: string): number {
  return Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 3600_000));
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>{title}</h1>
        <p style={{ color: "#52525b", margin: 0 }}>{text}</p>
      </div>
    </main>
  );
}

export default async function ThemePreviewPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ page?: string }> }) {
  const h = await headers();
  if (!isPlatformMarketingHost(h.get("x-forwarded-host") ?? h.get("host"))) notFound();

  const { code } = await params;
  const { page } = await searchParams;
  const { rt } = server();
  const preview = await getThemePreview(rt, code).catch(() => null);
  if (!preview) return <Notice title="This preview link has expired" text="Ask for a new one from the theme editor (Preview)." />;

  const keys = [...ORDER.filter((k) => preview.pages[k]), ...Object.keys(preview.pages).filter((k) => !ORDER.includes(k) && k !== "header" && k !== "footer")];
  const current = page && keys.includes(page) ? page : (keys[0] ?? "home");
  const blocks = preview.pages[current] ?? [];
  const header = preview.pages["header"] ?? [];
  const footer = preview.pages["footer"] ?? [];

  const themeVars = computeThemeTokens(null, preview.tokens);
  const fontsHref = googleFontsHref(preview.tokens);
  const renderData = buildSampleRenderData([...header, ...blocks, ...footer] as BlockInstance[]);
  const hoursLeft = hoursUntil(preview.expiresAt);
  const label = (k: string) => (k in THEME_PAGE_LABELS ? THEME_PAGE_LABELS[k as keyof typeof THEME_PAGE_LABELS] : k);

  return (
    <div style={themeVars as React.CSSProperties} className="bs-skin" data-theme-preview="">
      {fontsHref ? <link rel="stylesheet" href={fontsHref} precedence="default" /> : null}
      <div style={{ background: "#18181b", color: "#fafafa", fontFamily: "system-ui, sans-serif", fontSize: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 16px", padding: "8px 16px", maxWidth: 1280, margin: "0 auto" }}>
          <strong>Theme preview</strong>
          <span style={{ opacity: 0.75 }}>
            {preview.name} · sample data · link expires in about {hoursLeft} h
          </span>
          <nav aria-label="Preview pages" style={{ display: "flex", gap: 4, marginLeft: "auto", flexWrap: "wrap" }}>
            {keys.map((k) => (
              <a
                key={k}
                href={`?page=${k}`}
                aria-current={k === current ? "page" : undefined}
                style={{ padding: "3px 10px", borderRadius: 999, textDecoration: "none", color: k === current ? "#18181b" : "#fafafa", background: k === current ? "#fafafa" : "transparent", border: "1px solid #52525b" }}
              >
                {label(k)}
              </a>
            ))}
          </nav>
        </div>
      </div>

      <ThemeChrome blocks={header} renderData={renderData} storeName={preview.name} />
      <main>
        <BlockRenderer
          blocks={blocks}
          renderData={renderData}
          context={{
            storeName: preview.name,
            renderCollectionListing: (options) => (
              <CollectionListingSection collection={sampleCollection().collection} products={sampleCollection().products} page={1} limit={24} rawSort="created_desc" inStockOnly={false} options={options} />
            ),
            renderProductDetail: (options) => <ProductDetailSection product={sampleProductDetail()} options={options} />,
            renderCartContents: (options) => <CartView cart={sampleCart()} options={options} freeShippingThresholdPaise={299900} />,
          }}
        />
      </main>
      <ThemeChrome blocks={footer} renderData={renderData} storeName={preview.name} />
    </div>
  );
}
