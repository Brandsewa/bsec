import type { BlockData, BlockInstance, BlockProduct } from "./types.ts";
import { walkBlocks } from "./tree.ts";

/**
 * Stand-in products and collections for a theme that belongs to no store (theme previews, editors).
 * Prices are in paise, like real catalog data. No images: product cards draw their placeholder.
 */
export function sampleProducts(limit: number): BlockProduct[] {
  return Array.from({ length: Math.max(1, Math.min(limit, 8)) }, (_, i) => ({
    id: `sample-${i}`,
    title: `Sample product ${i + 1}`,
    slug: `sample-${i + 1}`,
    priceMin: 49900 + i * 10000,
    compareAtPriceMin: i % 3 === 0 ? 69900 + i * 10000 : undefined,
    ratingAvg: "4.5",
    ratingCount: 12 + i,
    priceMax: i % 2 === 0 ? 49900 + i * 10000 + 20000 : undefined,
    categoryName: ["Jams & spreads", "Squash & juice", "Pickles"][i % 3],
  }));
}

/** Render data (products and collections per block id) for blocks that need store data. */
export function buildSampleRenderData(blocks: BlockInstance[]): { data: Record<string, BlockData>; media: Record<string, string> } {
  const data: Record<string, BlockData> = {};
  walkBlocks(blocks, (b) => {
    if (b.type === "ProductGrid" || b.type === "ProductCarousel") {
      data[b.id] = { kind: "products", products: sampleProducts(Number(b.props["limit"]) || 8) };
    } else if (b.type === "ProductShowcase") {
      const tabs = Array.isArray(b.props["tabs"]) ? (b.props["tabs"] as unknown[]) : [{}];
      data[b.id] = { kind: "product-tabs", tabs: tabs.slice(0, 6).map(() => ({ products: sampleProducts(Number(b.props["limit"]) || 8) })) };
    } else if (b.type === "CollectionGrid") {
      data[b.id] = {
        kind: "collections",
        collections: ["Collection one", "Collection two", "Collection three"].map((title, i) => ({ slug: `collection-${i + 1}`, title })),
      };
    }
  });
  return { data, media: {} };
}
