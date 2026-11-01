import type { BlockInstance } from "@bs/blocks";
import {
  LAUNCH_TEMPLATE_FOOTER,
  LAUNCH_TEMPLATE_HOME,
} from "./launch-template.ts";

/**
 * "Modern Commerce": a platform theme whose collection, product and cart pages are laid out
 * with conversion best practice (trust signals next to the buy box, reassurance under the cart,
 * recommendations after the decision point). Built only from registry blocks; the dynamic cores
 * (CollectionListing, ProductDetail, CartContents) stay in storefront code. It is seeded as an
 * unpublished draft (`pnpm --filter @bs/platform seed:templates`), then refined in Super Admin.
 */
export const MODERN_TEMPLATE_NAME = "Modern Commerce";

export const MODERN_TEMPLATE_TOKENS = {
  colors: {
    primary: "#1f3a5f",
    secondary: "#475569",
    accent: "#e11d48",
    background: "#ffffff",
    surface: "#f6f7f9",
    text: "#111827",
  },
  fonts: { heading: "Poppins", body: "Inter" },
  radius: "md",
  buttons: { style: "solid", uppercase: false },
} as const;

const b = (id: string, type: BlockInstance["type"], props: Record<string, unknown>): BlockInstance => ({
  id,
  type,
  version: 1,
  props,
});

const TRUST_ITEMS = [
  { icon: "truck", title: "Free shipping", description: "On orders above ₹999" },
  { icon: "shield", title: "Secure checkout", description: "UPI, cards and cash on delivery" },
  { icon: "returns", title: "Easy returns", description: "7-day return guarantee" },
  { icon: "support", title: "Friendly support", description: "Phone and WhatsApp" },
];

/** Collection page: products first, then reassurance and discovery. */
export const MODERN_TEMPLATE_COLLECTION: BlockInstance[] = [
  b("mc-collection", "CollectionProducts", {
    showTitle: true,
    columns: "4",
    columnsTablet: "2",
    columnsMobile: "2",
    imageRatio: "portrait",
    cardStyle: "borderless",
    showSaleBadge: true,
    showRatings: true,
    showBreadcrumb: false,
    showFilters: true,
    showDescription: true,
    defaultView: "grid",
    showViewToggle: true,
    pageSize: "12",
    filtersCollapsible: true,
    showAddToCart: true,
    showQuickAdd: true,
    showViewProduct: true,
    showCategoryBadge: true,
    hoverSecondImage: true,
  }),
  b("mc-collection-usp", "TrustStrip", { items: TRUST_ITEMS }),
  b("mc-collection-picks", "ProductShowcase", {
    title: "Customer favourites",
    subtitle: "Most loved across the store",
    tabs: [{ label: "Customer favourites", source: "featured", collectionSlug: "" }],
    limit: 8,
    tone: "surface",
  }),
];

/** Product page: sticky buy box, trust signals, details accordion, reviews, then recommendations. */
export const MODERN_TEMPLATE_PRODUCT: BlockInstance[] = [
  b("mc-product", "ProductDetail", {
    galleryPosition: "left",
    thumbPosition: "left",
    showBreadcrumb: true,
    showRating: true,
    showSku: true,
    showDescription: true,
    showReadMore: true,
    variantStyle: "pills",
    priceNote: "Tax and shipping calculated at checkout.",
    addToCartLabel: "Add to cart",
    showBuyNow: true,
    buyNowLabel: "Buy it now",
    showPaymentImage: true,
    paymentImageAlt: "Secure payment",
    showDeliveryEstimate: true,
    cutoffHour: 14,
    deliveryDays: 3,
    shipsText: "Ships within 24 hrs",
    timeZone: "Asia/Kolkata",
    showUsps: true,
    usps: [
      { icon: "truck", text: "Fast dispatch", description: "Packed and shipped within 24 hours" },
      { icon: "shield", text: "Secure payment", description: "Encrypted checkout, details stay private" },
      { icon: "returns", text: "Easy returns", description: "Simple returns if something is not right" },
    ],
    showTags: false,
    stickyBuyBox: true,
    showTrustPoints: false,
    stickyMobileBar: true,
  }),
  b("mc-product-reviews", "Reviews", { title: "Customer reviews", showAggregate: true, limit: 6 }),
  // The same carousel as the home page's Product showcase, fed with products related to the one being viewed.
  b("mc-product-more", "ProductShowcase", {
    title: "You may also like",
    subtitle: "",
    tabs: [{ label: "Related", source: "related", collectionSlug: "" }],
    limit: 10,
    tone: "surface",
  }),
];

/** Collection archive: a heading and every published collection as a card grid. */
export const MODERN_TEMPLATE_COLLECTIONS: BlockInstance[] = [
  b("mc-archive", "CollectionGrid", { title: "Shop by collection", subtitle: "Browse everything we sell", collectionSlugs: [], showAll: true, columns: "3" }),
  b("mc-archive-usp", "TrustStrip", { items: TRUST_ITEMS }),
];

/** Cart page: the cart first, reassurance under it, one row of discovery. */
export const MODERN_TEMPLATE_CART: BlockInstance[] = [
  b("mc-cart", "CartContents", {
    summaryPosition: "right",
    stickySummary: true,
    showDiscountCode: true,
    showShippingEstimator: true,
    heading: "Your cart",
    checkoutLabel: "Secure checkout",
    showFreeShippingBar: true,
    showTrustPoints: true,
    trustPoints: ["Secure payment", "Cash on delivery available", "Easy returns"],
    stickyMobileCheckout: true,
    showContinueShopping: true,
  }),
  b("mc-cart-usp", "TrustStrip", { items: TRUST_ITEMS }),
  b("mc-cart-more", "ProductShowcase", {
    title: "Complete your order",
    subtitle: "Popular add-ons from our store",
    tabs: [{ label: "Add-ons", source: "featured", collectionSlug: "" }],
    limit: 8,
  }),
];

export const MODERN_TEMPLATE_HEADER: BlockInstance[] = [
  b("mc-banner", "Banner", { text: "Free shipping on orders over ₹999", link: "/collections/all", variant: "promo", dismissible: false }),
  b("mc-header", "SiteHeader", {
    menuHandle: "header",
    links: [
      { label: "Home", href: "/" },
      { label: "Shop all", href: "/collections/all" },
      { label: "Our story", href: "/pages/about" },
    ],
    layout: "left",
    showSearch: true,
    showCart: true,
    sticky: true,
    tone: "default",
  }),
];

/**
 * Home page: the shared launch layout with a "From the blog" section before the testimonials. The section hides
 * itself when the store has no posts, so a new store shows no empty heading (ADR-033).
 */
export const MODERN_TEMPLATE_HOME: BlockInstance[] = (() => {
  const blog = b("mc-home-blog", "BlogShowcase", { title: "From the blog", subtitle: "Guides, stories and news", count: 3, layout: "grid" });
  // The launch layout already ends with Floating reviews (the store's own published reviews; it hides itself until the
  // store has some); the blog section goes in front of them.
  const base = LAUNCH_TEMPLATE_HOME;
  const at = base.findIndex((x) => x.type === "ReviewsMarquee");
  return at < 0 ? [...base, blog] : [...base.slice(0, at), blog, ...base.slice(at)];
})();

/** Blog archive: every post as a card grid with category links and page numbers (the BlogListing core). */
export const MODERN_TEMPLATE_BLOG_ARCHIVE: BlockInstance[] = [
  b("mc-blog", "BlogListing", { title: "Blog", subtitle: "Guides, stories and news from our store", showCategories: true, layout: "grid", columns: "3", columnsTablet: "2", columnsMobile: "1", imageRatio: "landscape", showExcerpt: true, showDate: true, showReadingTime: true }),
];

/** Blog post: the post (the BlogPostContent core), then the shop again. */
export const MODERN_TEMPLATE_BLOG_POST: BlockInstance[] = [
  b("mc-blog-post", "BlogPostContent", { showBreadcrumb: true, showCategory: true, showDate: true, showAuthor: true, showReadingTime: true, featuredImage: "above", contentWidth: "narrow", showToc: true, showShare: true, showRelated: true, relatedCount: 3, showPrevNext: true }),
  b("mc-blog-post-usp", "TrustStrip", { items: TRUST_ITEMS }),
];

/**
 * Footer: the launch footer with its link columns tied to the store's own menus ("footer" and "footer-help", Online
 * Store > Navigation). The typed-in links stay as the fallback for a store that has not made those menus.
 */
export const MODERN_TEMPLATE_FOOTER: BlockInstance[] = LAUNCH_TEMPLATE_FOOTER.map((blk) => {
  if (blk.type !== "SiteFooter" || !Array.isArray(blk.props["columns"])) return blk;
  const handles = ["footer", "footer-help"];
  const columns = (blk.props["columns"] as Array<Record<string, unknown>>).map((c, i) => (handles[i] ? { ...c, menuHandle: handles[i] } : c));
  return { ...blk, props: { ...blk.props, columns } };
});

/** Every page of the theme, keyed as theme_templates.draft_pages stores them. */
export const MODERN_TEMPLATE_PAGES = {
  home: MODERN_TEMPLATE_HOME,
  collections: MODERN_TEMPLATE_COLLECTIONS,
  collection: MODERN_TEMPLATE_COLLECTION,
  product: MODERN_TEMPLATE_PRODUCT,
  cart: MODERN_TEMPLATE_CART,
  blog: MODERN_TEMPLATE_BLOG_ARCHIVE,
  "blog-post": MODERN_TEMPLATE_BLOG_POST,
  header: MODERN_TEMPLATE_HEADER,
  footer: MODERN_TEMPLATE_FOOTER,
};
