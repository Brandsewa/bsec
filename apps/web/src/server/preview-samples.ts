import type { BlogPostPage, BlogPostSummary, PublicBlogCategory, PublicBlogList, StorefrontCart, StorefrontCollectionDetail, StorefrontProductDetail } from "@bs/domain";

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
    categoryName: "Category",
    quickAdd: { singleVariantId: `sample-variant-${i}`, inStock: true },
  }));
  return {
    collection: { id: "sample-collection", title: "Bestsellers", slug: "bestsellers", type: "manual", rules: null, sortOrder: "manual", imageMediaId: null, description: "A short description of this collection appears here.", descriptionJson: { v: 1, blocks: [{ type: "paragraph", text: "The long description of this collection appears below the products." }] }, seo: null, indexable: true, published: true, createdAt: NOW, updatedAt: NOW },
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
    priceOnRequest: false,
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

const SAMPLE_BLOG_TITLES = ["How to choose your first pair", "Five ways to care for handmade pieces", "Behind the scenes at our workshop", "Gift ideas for every budget", "A guide to sizing and fit", "What is new this season"];

function sampleBlogSummary(i: number): BlogPostSummary {
  return {
    id: `sample-post-${i}`,
    slug: `sample-post-${i + 1}`,
    title: SAMPLE_BLOG_TITLES[i] ?? `Sample post ${i + 1}`,
    excerpt: "A short summary of the post appears here. It is cut after a few lines on the blog list.",
    publishedAt: NOW,
    authorName: "Your team",
    readingMinutes: 3 + (i % 4),
    isFeatured: i === 0,
    image: null,
    category: { id: "sample-cat", name: i % 2 === 0 ? "Guides" : "News", slug: i % 2 === 0 ? "guides" : "news", path: i % 2 === 0 ? "guides" : "news" },
  };
}

export function sampleBlogCategories(): PublicBlogCategory[] {
  return [
    { id: "c1", name: "Guides", slug: "guides", path: "guides", description: null, postCount: 3, children: [] },
    { id: "c2", name: "News", slug: "news", path: "news", description: null, postCount: 3, children: [] },
  ];
}

export function sampleBlogList(): PublicBlogList {
  return {
    enabled: true,
    settings: { enabled: true, title: "Blog", description: "", postsPerPage: 9 },
    posts: Array.from({ length: 6 }, (_, i) => sampleBlogSummary(i)),
    total: 6,
    page: 1,
    pages: 1,
    category: null,
    categoryMissing: false,
  };
}

export function sampleBlogPost(): BlogPostPage {
  const html = [
    "<p>This is where the post begins. A good opening tells the reader what they will learn.</p>",
    '<h2 id="start-here">Start here</h2>',
    "<p>Body text of the post appears here, with headings, lists and links written in the post editor.</p>",
    '<h2 id="next-steps">Next steps</h2>',
    "<ul><li>First point</li><li>Second point</li></ul>",
    '<h2 id="wrap-up">Wrap up</h2>',
    "<p>A closing paragraph.</p>",
  ].join("");
  return {
    ...sampleBlogSummary(0),
    contentHtml: html,
    headings: [
      { id: "start-here", text: "Start here", level: 2 },
      { id: "next-steps", text: "Next steps", level: 2 },
      { id: "wrap-up", text: "Wrap up", level: 2 },
    ],
    modifiedAt: NOW,
    seo: null,
    seoImage: null,
    noindex: false,
    related: [1, 2, 3].map(sampleBlogSummary),
    previous: { slug: "sample-post-5", title: "An older sample post" },
    next: { slug: "sample-post-6", title: "A newer sample post" },
  };
}
