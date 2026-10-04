import type { StorefrontCart, StorefrontCollectionDetail, StorefrontProductDetail } from "@bs/domain";

/**
 * Stand-in catalog data for theme previews, where there is no store. Prices are paise, ids are fake, and there
 * are no images (cards and the gallery draw their placeholders). Nothing here is ever written anywhere.
 */

const NOW = "2026-01-01T00:00:00.000Z";

export function sampleCollection(): StorefrontCollectionDetail {
  const items = Array.from({ length: 8 }, (_, i) => ({
    id: `sample-${i}`,
    title: ["Cotton Kurta", "Block Print Dupatta", "Handloom Saree", "Linen Shirt", "Ceramic Chai Cups", "Brass Diya", "Jute Basket", "Leather Wallet"][i] ?? `Sample product ${i + 1}`,
    slug: `sample-${i + 1}`,
    shortDescription: null,
    priceMin: 49900 + i * 15000,
    priceMax: 49900 + i * 15000,
    compareAtPriceMin: i % 3 === 0 ? 69900 + i * 15000 : undefined,
    isFeatured: i === 1,
    ratingAvg: "4.5",
    ratingCount: 10 + i * 3,
  }));
  return {
    collection: { id: "sample-collection", title: "Bestsellers", slug: "bestsellers", type: "manual", rules: null, sortOrder: "manual", imageMediaId: null, seo: null, published: true, createdAt: NOW, updatedAt: NOW },
    products: { items, total: items.length, page: 1, limit: 24 },
  };
}

export function sampleProductDetail(): StorefrontProductDetail {
  const variant = (id: string, title: string, size: string, stock: number) => ({
    id,
    productId: "sample-product",
    sku: `SAMPLE-${size}`,
    barcode: null,
    title,
    optionValues: { Size: size },
    price: 149900,
    compareAtPrice: 189900,
    trackInventory: true,
    allowBackorder: false,
    position: 0,
    imageMediaId: null,
    stockStatus: stock > 5 ? ("in_stock" as const) : ("low_stock" as const),
    availableQuantity: stock,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return {
    id: "sample-product",
    title: "Cotton Kurta",
    slug: "cotton-kurta",
    status: "active",
    descriptionJson: null,
    shortDescription: "Soft, breathable cotton with a relaxed fit. A sample product shown only in theme previews.",
    brandId: null,
    brand: null,
    productType: null,
    tags: ["cotton", "summer"],
    seo: null,
    requiresShipping: true,
    isFeatured: true,
    ratingAvg: "4.6",
    ratingCount: 128,
    createdAt: NOW,
    updatedAt: NOW,
    options: [{ id: "opt-size", productId: "sample-product", name: "Size", position: 0, values: ["S", "M", "L"] }],
    variants: [variant("v-s", "S", "S", 25), variant("v-m", "M", "M", 3), variant("v-l", "L", "L", 18)],
    media: [],
  };
}

export function sampleCart(): StorefrontCart {
  const line = (n: number, title: string, price: number, qty: number) => ({
    id: `line-${n}`,
    cartId: "sample-cart",
    variantId: `v-${n}`,
    quantity: qty,
    unitPriceSnapshot: price,
    lineTotal: price * qty,
    properties: null,
    product: { id: `p-${n}`, title, slug: `sample-${n}` },
    variant: { id: `v-${n}`, sku: `SAMPLE-${n}`, title: "M", optionValues: { Size: "M" }, price },
    primaryImage: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const items = [line(1, "Cotton Kurta", 149900, 1), line(2, "Block Print Dupatta", 89900, 2)];
  return {
    id: "sample-cart",
    token: "sample",
    currency: "INR",
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotal: items.reduce((n, i) => n + i.lineTotal, 0),
    lastActivityAt: NOW,
    createdAt: NOW,
  };
}
