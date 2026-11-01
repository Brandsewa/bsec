import type { CSSProperties, ReactNode } from "react";
import type { z } from "zod";
import type { Layout } from "./layout.ts";

export type BlockType =
  // Sections and content (M2)
  | "Banner"
  | "CollectionGrid"
  | "Reviews"
  | "Gallery"
  | "TrustStrip"
  // Layout primitives: hold child blocks in their `content` slot
  | "Section"
  | "Container"
  | "Block"
  // Content primitives
  | "Heading"
  | "Text"
  | "Image"
  | "Video"
  | "Button"
  // Conversion widgets
  // Store chrome and page cores (theme header/footer, product page, collection page)
  | "SiteHeader"
  | "SiteFooter"
  | "ProductDetail"
  | "ProductCustomField"
  | "ProductCoupons"
  | "ContactForm"
  | "CollectionListing"
  | "CartContents"
  | "HeroSlider"
  | "ProductShowcase"
  // Blog (ADR-033): the archive and single post cores, and the Recent Posts widget
  | "BlogListing"
  | "BlogPostContent"
  // Floating customer reviews, fed by the store's product reviews
  | "ReviewsMarquee"
  // A picture banner with its own eyebrow, heading, description and buttons placed anywhere on the picture
  | "ImageBanner"
  // FAQ accordion with heading and description, split or stacked layout, card or plain look, icon on either side
  | "FaqSection"
  // Collection grid with a movable heading, a button link, wrapping rows and a carousel option for tablets and phones
  | "CollectionShowcase"
  // Cards with icon or picture, heading, text and link: a grid, or a slider on tablets and phones
  | "MultiCard"
  // The collection page's product grid (sort, filters, cards) without its title block, so a page can put its own content around it
  | "CollectionProducts"
  // Recent posts as a slider (arrows, flat page lines) with cards per row per device and an optional list on phones
  | "BlogShowcase";

/** Minimal product shape the product blocks need; the host supplies the real data. Prices are in paise. */
export interface BlockProduct {
  id: string;
  title: string;
  slug: string;
  priceMin: number;
  compareAtPriceMin?: number | undefined;
  /** A "price on request" product has no public price; the card shows a label instead of a zero price. */
  priceOnRequest?: boolean | undefined;
  ratingAvg?: string | undefined;
  ratingCount?: number | undefined;
  imageMediaId?: string | undefined;
  /** Ready-to-use public URL of the primary image, when the host already knows it. */
  imageUrl?: string | undefined;
  imageAlt?: string | null | undefined;
  /** Highest variant price (a range shows "Starts from"). */
  priceMax?: number | undefined;
  brandName?: string | undefined;
  /** First category's name, for the card's badge. */
  categoryName?: string | undefined;
  /** Set only when the product has exactly one variant: the card can then add it to the cart straight away. */
  quickAddVariantId?: string | undefined;
}

export interface BlockCollectionSummary {
  slug: string;
  title: string;
  imageMediaId?: string | undefined;
  /** Listed products in the collection; only set where it is cheap to know (archive page, manual collections). */
  productCount?: number | undefined;
  /** The collection blurb (plain text), shown under the title on cards. */
  description?: string | undefined;
}

/** A blog post as the blocks draw it. URLs are ready to use. */
export interface BlockBlogPost {
  slug: string;
  title: string;
  excerpt: string;
  /** ISO date. */
  publishedAt: string;
  authorName: string;
  readingMinutes: number;
  imageUrl?: string | undefined;
  imageAlt?: string | undefined;
  imageWidth?: number | null | undefined;
  imageHeight?: number | null | undefined;
  /** Resized copies of the picture, for the img srcset (small files on small screens). */
  imageSrcSet?: string | undefined;
  imageSizes?: string | undefined;
  categoryName?: string | undefined;
  /** URL path under /blog/category/, for the category label's link. */
  categoryPath?: string | undefined;
}

/** A published product review as the Floating reviews widget draws it. */
export interface BlockReview {
  id: string;
  rating: number;
  title?: string | undefined;
  body: string;
  reviewerName: string;
  /** Bought the product (the review is linked to a delivered order item). */
  verified: boolean;
  productTitle?: string | undefined;
  productSlug?: string | undefined;
  /** ISO date. */
  createdAt: string;
}

export interface ResolvedMenuItem {
  id: string;
  label: string;
  url: string;
  href: string;
  type?: string | undefined;
  newTab?: boolean | undefined;
  openInNewTab?: boolean | undefined;
  children?: ResolvedMenuItem[] | undefined;
}

/** Server-resolved data for blocks that need store data, keyed by block id. */
export type BlockData =
  | { kind: "products"; products: BlockProduct[] }
  | { kind: "collections"; collections: BlockCollectionSummary[] }
  | { kind: "product-tabs"; tabs: Array<{ products: BlockProduct[] }> }
  | { kind: "blog-posts"; posts: BlockBlogPost[]; viewAllHref: string }
  | { kind: "reviews"; reviews: BlockReview[] }
  | { kind: "menu"; items: ResolvedMenuItem[] }
  | { kind: "footer-menus"; columns: Array<ResolvedMenuItem[] | null> }
  | { kind: "file"; filename: string; mime: string; bytes: number; url?: string | undefined };

export interface RenderMediaDetail {
  url: string;
  alt?: string | null | undefined;
  mime?: string | undefined;
  bytes?: number | undefined;
  filename?: string | undefined;
  width?: number | null | undefined;
  height?: number | null | undefined;
  focalX?: number | null | undefined;
  focalY?: number | null | undefined;
  dominantColor?: string | null | undefined;
  derivatives?: Record<string, { key: string; width: number; height: number; bytes: number }> | null | undefined;
}

/**
 * Host-provided rendering context. Blocks stay UI-agnostic: the storefront and the
 * visual editor each inject how media URLs and product cards are drawn.
 */
export interface RenderContext {
  mediaUrl?: ((mediaId: string) => string | null) | undefined;
  mediaDetails?: ((mediaId: string) => RenderMediaDetail | null) | undefined;
  data?: Record<string, BlockData | undefined> | undefined;
  renderProductCard?: ((product: BlockProduct, opts: { showPrice: boolean; showRating: boolean }) => ReactNode) | undefined;
  /** Stable id of the block being rendered (for data lookup). */
  blockId?: string | undefined;
  /** The shopper's market currency and locale for prices (ADR-040). Prices render as INR when the host gives none. */
  currency?: string | undefined;
  locale?: string | undefined;
  /** Store details for the header and footer. */
  storeName?: string | undefined;
  logoUrl?: string | null | undefined;
  /** Client-side navigation link (storefront passes next/link); plain anchors otherwise. */
  renderLink?: ((p: { href: string; className?: string; children: ReactNode }) => ReactNode) | undefined;
  /** Cart icon with live count (a client component supplied by the storefront). */
  renderCart?: (() => ReactNode) | undefined;
  /** Account link showing "Login" or the signed-in shopper's name (a client component supplied by the storefront). */
  renderAccount?: (() => ReactNode) | undefined;
  /** The real product page body / collection listing; the editor draws labelled placeholders instead. */
  renderProductDetail?: ((opts: ProductDetailOptions) => ReactNode) | undefined;
  /** The announcement bar's previous / next arrows (a small client wrapper on the storefront); the editors draw them without behaviour. */
  renderBanner?: ((p: { children: ReactNode }) => ReactNode) | undefined;
  /** The product's long description and the theme's shipping and returns text in tabs; the editor draws a labelled placeholder instead. */
  /** One custom field of the current product (ADR-034), drawn by the storefront from the product's data; the editor draws a labelled sample instead. */
  renderProductCustomField?: ((opts: ProductCustomFieldOptions) => ReactNode) | undefined;
  /** The store's coupon cards with the "view all" drawer (needs the store's discounts, so the storefront draws it). */
  /** The live contact form (posts to the store); the editor draws a static sample. */
  renderContactForm?: ((opts: ContactFormOptions) => ReactNode) | undefined;
  renderProductCoupons?: ((opts: ProductCouponsOptions) => ReactNode) | undefined;
  renderCollectionListing?: ((opts: CollectionListingOptions) => ReactNode) | undefined;
  /** The real blog archive / single post (drawn by the storefront from the request's data); the editor draws labelled samples instead. */
  renderBlogListing?: ((opts: BlogListingOptions) => ReactNode) | undefined;
  renderBlogPost?: ((opts: BlogPostOptions) => ReactNode) | undefined;
  /** The real cart (items, totals, discount code); the editor draws a labelled placeholder instead. */
  renderCartContents?: ((opts: CartContentsOptions) => ReactNode) | undefined;
  /** Wraps the hero slider's server-rendered markup with its autoplay / navigation behaviour (a client component). The editor draws it static. */
  renderHeroSlider?: ((p: { options: HeroSliderBehavior; children: ReactNode }) => ReactNode) | undefined;
  /** Same for the product showcase: tab switching, page dots, arrows, autoplay and quick add to cart. */
  renderProductShowcase?: ((p: { options: ProductShowcaseBehavior; children: ReactNode }) => ReactNode) | undefined;
  /** Wraps the gallery grid with its click-to-open viewer (a client component). The editor draws the grid without it. */
  renderGallery?: ((p: { images: GalleryViewerImage[]; children: ReactNode }) => ReactNode) | undefined;
}

/** One picture in the gallery viewer: the full-size source and a small one for the thumbnail strip. */
export interface GalleryViewerImage {
  src: string;
  thumb: string;
  alt: string;
  caption?: string | undefined;
}

/** How a hero slider behaves in the browser. The markup is server-rendered; the host adds this behaviour. */
export interface HeroSliderBehavior {
  autoplay: boolean;
  /** Seconds each slide stays. */
  interval: number;
  loop: boolean;
  pauseOnHover: boolean;
}

/** Behaviour of a product showcase in the browser (tabs, autoplay, looping); the host adds it to the server-rendered markup. */
export interface ProductShowcaseBehavior {
  tabs: boolean;
  autoplay: boolean;
  interval: number;
  loop: boolean;
  pauseOnHover: boolean;
}

export interface ContactFormOptions {
  formName: string;
  fieldAlign?: "left" | "center" | "right" | undefined;
  recipientEmail: string;
  showPhone: boolean;
  phoneRequired: boolean;
  showDropdown: boolean;
  dropdownLabel: string;
  /** Comma-separated choices. */
  dropdownOptions: string;
  showMessage: boolean;
  messageLabel: string;
  messageRequired: boolean;
  submitLabel: string;
  successMessage: string;
  consentText: string;
}

export interface ProductCouponsOptions {
  title: string;
  /** Cards shown before "View all". */
  showCount: number;
  showViewAll: boolean;
  viewAllLabel: string;
}

export interface ProductCustomFieldOptions {
  /** The custom field's key (Settings > Custom fields). */
  fieldKey: string;
  showLabel: boolean;
  /** Replaces the field's own name when set. */
  label: string;
}

export interface ProductDetailOptions {
  galleryPosition: "left" | "right";
  showBreadcrumb: boolean;
  showRating: boolean;
  showDescription: boolean;
  showTags: boolean;
  showCoupons?: boolean | undefined;
  couponCount?: number | undefined;
  /** Desktop: the buy box stays in view while the gallery scrolls. */
  stickyBuyBox?: boolean | undefined;
  /** Short reassurance lines under the add-to-cart button (e.g. "Secure checkout"). */
  showTrustPoints?: boolean | undefined;
  trustPoints?: string[] | undefined;
  /** Phone: a bar with the price and an add-to-cart button appears once the main button scrolls out of view. */
  stickyMobileBar?: boolean | undefined;
  showSku?: boolean | undefined;
  thumbPosition?: "bottom" | "left" | "right" | undefined;
  showReadMore?: boolean | undefined;
  variantStyle?: "buttons" | "pills" | "dropdown" | undefined;
  priceNote?: string | undefined;
  showBuyNow?: boolean | undefined;
  addToCartLabel?: string | undefined;
  buyNowLabel?: string | undefined;
  addToCartBg?: string | undefined;
  addToCartText?: string | undefined;
  buyNowBg?: string | undefined;
  buyNowText?: string | undefined;
  showPaymentImage?: boolean | undefined;
  paymentImageMediaId?: string | undefined;
  paymentImageAlt?: string | undefined;
  showDeliveryEstimate?: boolean | undefined;
  cutoffHour?: number | undefined;
  deliveryDays?: number | undefined;
  shipsText?: string | undefined;
  timeZone?: string | undefined;
  showUsps?: boolean | undefined;
  usps?: Array<{ icon: string; text: string; description?: string | undefined }> | undefined;
  /** Order of the buy-box elements (names from PRODUCT_ELEMENTS); empty or missing = the default order. */
  elementOrder?: string[] | undefined;
  showAccordion?: boolean | undefined;
  accordionFirstOpen?: boolean | undefined;
  accordionItems?:
    | Array<{ icon: string; title: string; source: "static" | "custom_field"; fieldKey?: string | undefined; text?: string | undefined }>
    | undefined;
}

export interface CartContentsOptions {
  summaryPosition: "right" | "left";
  stickySummary: boolean;
  showDiscountCode: boolean;
  showShippingEstimator: boolean;
  heading?: string | undefined;
  checkoutLabel?: string | undefined;
  /** Progress towards the store's own free-shipping threshold (from its shipping settings), when it has one. */
  showFreeShippingBar?: boolean | undefined;
  showTrustPoints?: boolean | undefined;
  trustPoints?: string[] | undefined;
  /** Phone: the total and checkout button stay at the bottom of the screen. */
  stickyMobileCheckout?: boolean | undefined;
  showContinueShopping?: boolean | undefined;
}

export interface BlogListingOptions {
  title: string;
  subtitle?: string | undefined;
  showCategories: boolean;
  layout: "grid" | "list";
  columns: "2" | "3" | "4";
  columnsTablet: "1" | "2";
  columnsMobile: "1" | "2";
  featuredFirst: boolean;
  showImage: boolean;
  showExcerpt: boolean;
  showDate: boolean;
  showAuthor: boolean;
  showReadingTime: boolean;
  showCategoryLabel: boolean;
  imageRatio: "landscape" | "square" | "portrait";
  postsPerPage: number;
  emptyText: string;
  /** magazine: header with subscribe form, latest posts, then a row per category (the blog index only). */
  style?: "classic" | "magazine" | undefined;
  headlineBold?: string | undefined;
  headlineLight?: string | undefined;
  showSubscribe?: boolean | undefined;
  subscribeLabel?: string | undefined;
  subscribePlaceholder?: string | undefined;
  subscribeTitle?: string | undefined;
  subscribeText?: string | undefined;
  latestSideCount?: number | undefined;
  showCategorySections?: boolean | undefined;
  postsPerCategory?: number | undefined;
}

export interface BlogPostOptions {
  showBreadcrumb: boolean;
  showCategory: boolean;
  showDate: boolean;
  showAuthor: boolean;
  showReadingTime: boolean;
  featuredImage: "above" | "wide" | "hidden";
  contentWidth: "narrow" | "normal";
  showToc: boolean;
  showShare: boolean;
  showRelated: boolean;
  relatedCount: number;
  showPrevNext: boolean;
  /** magazine: picture across the top, table of contents on the left, text in the middle, sidebar on the right. */
  layout?: "classic" | "magazine" | undefined;
  tocPosition?: "left" | "right" | undefined;
  showSidebar?: boolean | undefined;
  showAboutCard?: boolean | undefined;
  aboutTitle?: string | undefined;
  aboutText?: string | undefined;
  showFeatured?: boolean | undefined;
  featuredCount?: number | undefined;
  showCategoriesCloud?: boolean | undefined;
  showSubscribe?: boolean | undefined;
  subscribeTitle?: string | undefined;
  subscribeText?: string | undefined;
  subscribePlaceholder?: string | undefined;
  subscribeLabel?: string | undefined;
}

export interface CollectionListingOptions {
  columns: "2" | "3" | "4";
  showFilters: boolean;
  showDescription: boolean;
  columnsMobile?: "1" | "2" | undefined;
  imageRatio?: "square" | "portrait" | undefined;
  cardStyle?: "borderless" | "bordered" | "minimal" | undefined;
  showSaleBadge?: boolean | undefined;
  showRatings?: boolean | undefined;
  showBreadcrumb?: boolean | undefined;
  filterMenuHandle?: string | undefined;
  columnsTablet?: "1" | "2" | undefined;
  defaultView?: "grid" | "list" | undefined;
  showViewToggle?: boolean | undefined;
  pageSize?: "12" | "24" | "36" | undefined;
  filtersCollapsible?: boolean | undefined;
  showAddToCart?: boolean | undefined;
  showQuickAdd?: boolean | undefined;
  showViewProduct?: boolean | undefined;
  showCategoryBadge?: boolean | undefined;
  hoverSecondImage?: boolean | undefined;
  /** The Collection products widget: no built-in page heading or long description unless switched on, and its own section box. */
  bare?: boolean | undefined;
  showTitle?: boolean | undefined;
  showLongDescription?: boolean | undefined;
  tone?: "default" | "surface" | "primary" | "dark" | undefined;
  width?: "narrow" | "default" | "wide" | "full" | undefined;
  box?: Layout | undefined;
}

/**
 * A slot renderer: hosts that draw the slot themselves (the visual editor's drop zone) pass one
 * of these so layout classes land on the element that actually contains the children.
 */
export type SlotRender = (p: { className?: string; style?: CSSProperties }) => ReactNode;

export interface BlockRenderArgs<TProps> {
  props: TProps;
  /** Rendered children of the block's `content` slot (layout blocks only). */
  children?: ReactNode | SlotRender;
  ctx?: RenderContext | undefined;
}

export interface BlockDefinition<TProps = unknown> {
  type: BlockType;
  version: number;
  schema: z.ZodType<TProps>;
  defaultProps: TProps;
  render: (data: BlockRenderArgs<TProps>) => ReactNode;
  migrate?: (fromVersion: number, props: unknown) => TProps;
}

export interface BlockInstance {
  id: string;
  type: BlockType;
  version: number;
  props: Record<string, unknown>;
  hidden?: boolean | undefined;
}

export interface BlockDocument {
  version: 1;
  blocks: BlockInstance[];
}

/**
 * Props that hold nested block arrays. Only layout blocks have slots; the slot is always
 * named `content`. Validation, migration and rendering recurse through these.
 */
export const SLOT_BLOCK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  "Section",
  "Container",
  "Block",
]);
export const SLOT_PROP = "content";

/** Hard limits that keep documents (and the storefront's render cost) bounded. */
export const MAX_BLOCK_DEPTH = 6;
export const MAX_BLOCKS_PER_DOCUMENT = 300;
