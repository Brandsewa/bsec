import { describe, expect, it } from "vitest";
import { archiveCopy, archiveItems, archiveJsonLd, archiveMetadata, firstGridCopy } from "../src/lib/archive-meta.ts";

const FALLBACK = { title: "Collections", description: "Browse every collection in the store." };
const grid = (title: string, subtitle?: string) => [{ id: "g", type: "CollectionGrid", version: 1, props: { title, ...(subtitle ? { subtitle } : {}) } }];

describe("archiveCopy", () => {
  it("prefers the page's own SEO, then the first grid's title and subtitle, then the default", () => {
    expect(archiveCopy({ seo: { title: "All our teas", description: "Every tea." }, blocks: grid("Grid", "Sub"), fallback: FALLBACK })).toEqual({ title: "All our teas", description: "Every tea." });
    expect(archiveCopy({ seo: null, blocks: grid("Shop teas", "Loose leaf from Darjeeling"), fallback: FALLBACK })).toEqual({ title: "Shop teas", description: "Loose leaf from Darjeeling" });
    expect(archiveCopy({ seo: null, blocks: [], fallback: FALLBACK })).toEqual(FALLBACK);
  });

  it("finds a grid nested inside other blocks and decodes saved entities", () => {
    const nested = [{ type: "Section", props: {}, children: [{ type: "CollectionGrid", props: { title: "Tea &amp; Honey" } }] }];
    expect(firstGridCopy(nested)).toEqual({ title: "Tea &amp; Honey" });
    expect(archiveCopy({ seo: null, blocks: nested, fallback: FALLBACK }).title).toBe("Tea & Honey");
  });

  it("the categories page ignores the shared page SEO and collection wording", () => {
    const fb = { title: "Shop by category", description: "Browse every product category in the store." };
    expect(archiveCopy({ seo: { title: "Collections of tea" }, blocks: grid("Collections", "Browse everything we sell."), fallback: fb, shared: true })).toEqual({ title: "Shop by category", description: "Browse everything we sell." });
    expect(archiveCopy({ seo: null, blocks: grid("Our categories", "Find your tea"), fallback: fb, shared: true })).toEqual({ title: "Our categories", description: "Find your tea" });
  });
});

describe("archiveMetadata and archiveJsonLd", () => {
  const copy = { title: "Collections", description: "Browse." };

  it("gives a canonical on the store's host and market prefix, and brands the title once", () => {
    const m = archiveMetadata({ copy, storeName: "Ricwell", host: "ricwell.com", prefix: "/us", path: "/collections" });
    expect(m.alternates?.canonical).toBe("https://ricwell.com/us/collections");
    expect(m.title).toBe("Collections | Ricwell");
    expect(archiveMetadata({ copy: { title: "Ricwell collections", description: "x" }, storeName: "Ricwell", host: "h", prefix: "", path: "/categories" }).title).toBe("Ricwell collections");
  });

  it("describes the page as a CollectionPage with an ItemList of what it lists", () => {
    const items = archiveItems({ data: { g1: { kind: "collections", collections: [{ title: "Black", slug: "black" }, { title: "Green", slug: "green" }] }, g2: { kind: "menu" } } });
    expect(items).toEqual([{ title: "Black", slug: "black" }, { title: "Green", slug: "green" }]);
    const ld = archiveJsonLd({ copy, host: "ricwell.com", prefix: "", path: "/collections", itemPath: "/collections", items }) as { "@type": string; mainEntity: { numberOfItems: number; itemListElement: Array<{ url: string }> } };
    expect(ld["@type"]).toBe("CollectionPage");
    expect(ld.mainEntity.numberOfItems).toBe(2);
    expect(ld.mainEntity.itemListElement[1]?.url).toBe("https://ricwell.com/collections/green");
  });
});
