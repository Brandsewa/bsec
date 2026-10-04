import type { CSSProperties, ReactNode } from "react";
import type { z } from "zod";

export type BlockType =
  // Sections and content (M2)
  | "Hero"
  | "Banner"
  | "ProductGrid"
  | "CollectionGrid"
  | "ProductCarousel"
  | "Testimonials"
  | "Reviews"
  | "RichText"
  | "FAQ"
  | "Gallery"
  | "Newsletter"
  | "UspStrip"
  // Layout primitives: hold child blocks in their `content` slot
  | "Section"
  | "Container"
  | "Grid"
  | "FlexRow"
  | "FlexColumn"
  | "Spacer"
  | "Divider"
  // Content primitives
  | "Heading"
  | "Text"
  | "Image"
  | "Video"
  | "Button"
  | "Icon"
  | "Link"
  // Conversion widgets
  | "CallToAction"
  // Store chrome and page cores (theme header/footer, product page, collection page)
  | "SiteHeader"
  | "SiteFooter"
  | "ProductDetail"
  | "CollectionListing"
  | "CartContents"
  | "HeroSlider"
  | "ProductShowcase";

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
}

/** Server-resolved data for blocks that need store data, keyed by block id. */
export type BlockData =
  | { kind: "products"; products: BlockProduct[] }
  | { kind: "collections"; collections: BlockCollectionSummary[] }
  /** One product list per tab of a product showcase, in tab order. */
  | { kind: "product-tabs"; tabs: Array<{ products: BlockProduct[] }> };

/**
 * Host-provided rendering context. Blocks stay UI-agnostic: the storefront and the
 * visual editor each inject how media URLs and product cards are drawn.
 */
export interface RenderContext {
  mediaUrl?: ((mediaId: string) => string | null) | undefined;
  data?: Record<string, BlockData | undefined> | undefined;
  renderProductCard?: ((product: BlockProduct, opts: { showPrice: boolean; showRating: boolean }) => ReactNode) | undefined;
  /** Stable id of the block being rendered (for data lookup). */
  blockId?: string | undefined;
  /** Store details for the header and footer. */
  storeName?: string | undefined;
  logoUrl?: string | null | undefined;
  /** Client-side navigation link (storefront passes next/link); plain anchors otherwise. */
  renderLink?: ((p: { href: string; className?: string; children: ReactNode }) => ReactNode) | undefined;
  /** Cart icon with live count (a client component supplied by the storefront). */
  renderCart?: (() => ReactNode) | undefined;
  /** The real product page body / collection listing; the editor draws labelled placeholders instead. */
  renderProductDetail?: ((opts: ProductDetailOptions) => ReactNode) | undefined;
  renderCollectionListing?: ((opts: CollectionListingOptions) => ReactNode) | undefined;
  /** The real cart (items, totals, discount code); the editor draws a labelled placeholder instead. */
  renderCartContents?: ((opts: CartContentsOptions) => ReactNode) | undefined;
  /** Wraps the hero slider's server-rendered markup with its autoplay / navigation behaviour (a client component). The editor draws it static. */
  renderHeroSlider?: ((p: { options: HeroSliderBehavior; children: ReactNode }) => ReactNode) | undefined;
  /** Same for the product showcase: tab switching, page dots, arrows, autoplay and quick add to cart. */
  renderProductShowcase?: ((p: { options: ProductShowcaseBehavior; children: ReactNode }) => ReactNode) | undefined;
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

export interface ProductDetailOptions {
  galleryPosition: "left" | "right";
  showBreadcrumb: boolean;
  showRating: boolean;
  showDescription: boolean;
  showTags: boolean;
  /** Desktop: the buy box stays in view while the gallery scrolls. */
  stickyBuyBox?: boolean | undefined;
  /** Short reassurance lines under the add-to-cart button (e.g. "Secure checkout"). */
  showTrustPoints?: boolean | undefined;
  trustPoints?: string[] | undefined;
  /** Phone: a bar with the price and an add-to-cart button appears once the main button scrolls out of view. */
  stickyMobileBar?: boolean | undefined;
  showSku?: boolean | undefined;
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

export interface CollectionListingOptions {
  columns: "2" | "3" | "4";
  showFilters: boolean;
  showDescription: boolean;
  columnsMobile?: "1" | "2" | undefined;
  imageRatio?: "square" | "portrait" | undefined;
  cardStyle?: "bordered" | "minimal" | undefined;
  showSaleBadge?: boolean | undefined;
  showRatings?: boolean | undefined;
  showBreadcrumb?: boolean | undefined;
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
  "Grid",
  "FlexRow",
  "FlexColumn",
]);
export const SLOT_PROP = "content";

/** Hard limits that keep documents (and the storefront's render cost) bounded. */
export const MAX_BLOCK_DEPTH = 6;
export const MAX_BLOCKS_PER_DOCUMENT = 300;
