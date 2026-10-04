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
  b("mc-collection", "CollectionListing", {
    columns: "4",
    columnsMobile: "2",
    imageRatio: "portrait",
    cardStyle: "minimal",
    showSaleBadge: true,
    showRatings: true,
    showBreadcrumb: true,
    showFilters: true,
    showDescription: true,
  }),
  b("mc-collection-usp", "UspStrip", { items: TRUST_ITEMS }),
  b("mc-collection-picks", "ProductCarousel", {
    title: "Customer favourites",
    subtitle: "Most loved across the store",
    source: "featured",
    limit: 8,
    columns: "4",
    showPrice: true,
    showRating: true,
    tone: "surface",
  }),
  b("mc-collection-news", "Newsletter", {
    title: "Get first access to new arrivals",
    subtitle: "Join the list for launches and subscriber-only offers.",
    buttonText: "Subscribe",
    placeholder: "Your email address",
  }),
];

/** Product page: sticky buy box, trust signals, details accordion, reviews, then recommendations. */
export const MODERN_TEMPLATE_PRODUCT: BlockInstance[] = [
  b("mc-product", "ProductDetail", {
    galleryPosition: "left",
    showBreadcrumb: true,
    showRating: true,
    showDescription: true,
    showTags: false,
    stickyBuyBox: true,
    showSku: false,
    showTrustPoints: true,
    trustPoints: ["Secure checkout", "Easy returns", "Fast dispatch"],
    stickyMobileBar: true,
  }),
  b("mc-product-usp", "UspStrip", { items: TRUST_ITEMS.slice(0, 3) }),
  b("mc-product-faq", "FAQ", {
    title: "Shipping, returns and care",
    items: [
      { question: "How long will delivery take?", answer: "Orders usually arrive in 3-5 business days across India. You get tracking details as soon as your order ships." },
      { question: "What is the return policy?", answer: "Return unused items within 7 days of delivery for a refund or exchange." },
      { question: "Can I pay on delivery?", answer: "Yes. Choose cash on delivery at checkout, or pay online with UPI or card." },
    ],
  }),
  b("mc-product-reviews", "Reviews", { title: "Customer reviews", showAggregate: true, limit: 6 }),
  b("mc-product-more", "ProductCarousel", {
    title: "You may also like",
    source: "newest",
    limit: 8,
    columns: "4",
    showPrice: true,
    showRating: false,
    tone: "surface",
  }),
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
  b("mc-cart-usp", "UspStrip", { items: TRUST_ITEMS }),
  b("mc-cart-more", "ProductCarousel", {
    title: "Complete your order",
    subtitle: "Popular add-ons from our store",
    source: "featured",
    limit: 8,
    columns: "4",
    showPrice: true,
    showRating: false,
    tone: "default",
  }),
];

export const MODERN_TEMPLATE_HEADER: BlockInstance[] = [
  b("mc-banner", "Banner", { text: "Free shipping on orders over ₹999", link: "/collections/all", variant: "promo", dismissible: false }),
  b("mc-header", "SiteHeader", {
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

/** Every page of the theme, keyed as theme_templates.draft_pages stores them. */
export const MODERN_TEMPLATE_PAGES = {
  home: LAUNCH_TEMPLATE_HOME,
  collection: MODERN_TEMPLATE_COLLECTION,
  product: MODERN_TEMPLATE_PRODUCT,
  cart: MODERN_TEMPLATE_CART,
  header: MODERN_TEMPLATE_HEADER,
  footer: LAUNCH_TEMPLATE_FOOTER,
};
