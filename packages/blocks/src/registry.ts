import { z } from "zod";
import type { BlockDefinition, BlockType } from "./types.ts";
import {
  alignSchema,
  bgVideoUrlSchema,
  hexColorSchema,
  gapSchema,
  hrefSchema,
  ICON_NAMES,
  itemsSchema,
  justifySchema,
  slotSchema,
  spacingSchema,
  toneSchema,
  videoUrlSchema,
  widthSchema,
} from "./common.ts";
import { layoutSchema } from "./layout.ts";
import * as V from "./views.tsx";

/* ------------------------------------------------------------------ */
/* Sections and content blocks (M2). Schemas are additive-only: new    */
/* optional fields with defaults never require a version bump.         */
/* ------------------------------------------------------------------ */

// 1. Hero
export const HeroSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  ctaText: z.string().optional(),
  ctaLink: hrefSchema.optional(),
  secondaryCtaText: z.string().optional(),
  secondaryCtaLink: hrefSchema.optional(),
  backgroundMediaId: z.string().optional(),
  alignment: alignSchema.default("center"),
  overlayOpacity: z.number().min(0).max(100).default(30),
  eyebrow: z.string().optional(),
  tone: toneSchema.default("primary"),
  // Pre-registry starter templates and provisioning fallbacks used these names for the main button.
  buttonText: z.string().optional(),
  buttonUrl: hrefSchema.optional(),
});
export type HeroProps = z.infer<typeof HeroSchema>;

export const HeroBlock: BlockDefinition<HeroProps> = {
  type: "Hero",
  version: 1,
  schema: HeroSchema,
  defaultProps: {
    title: "Welcome to Our Store",
    subtitle: "Discover our handcrafted collection of high-quality products.",
    ctaText: "Shop Now",
    ctaLink: "/collections/all",
    alignment: "center",
    overlayOpacity: 30,
    tone: "primary",
  },
  render: V.HeroView,
};

// 2. Banner
export const BannerSchema = z.object({
  text: z.string().min(1),
  link: hrefSchema.optional(),
  dismissible: z.boolean().default(false),
  variant: z.enum(["info", "promo", "warning"]).default("promo"),
});
export type BannerProps = z.infer<typeof BannerSchema>;

export const BannerBlock: BlockDefinition<BannerProps> = {
  type: "Banner",
  version: 1,
  schema: BannerSchema,
  defaultProps: {
    text: "Special introductory offer: free shipping on orders over ₹999!",
    dismissible: false,
    variant: "promo",
  },
  render: V.BannerView,
};

const productSourceSchema = z.enum(["newest", "featured", "collection", "manual"]);

// 3. ProductGrid
export const ProductGridSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  source: productSourceSchema.optional(), // absent = "collection" if collectionSlug else "newest"
  collectionSlug: z.string().optional(),
  productSlugs: z.array(z.string().max(220)).max(24).default([]),
  limit: z.number().int().min(1).max(48).default(8),
  columns: z.enum(["2", "3", "4"]).default("4"),
  showPrice: z.boolean().default(true),
  showRating: z.boolean().default(true),
  tone: toneSchema.default("default"),
});
export type ProductGridProps = z.infer<typeof ProductGridSchema>;

export const ProductGridBlock: BlockDefinition<ProductGridProps> = {
  type: "ProductGrid",
  version: 1,
  schema: ProductGridSchema,
  defaultProps: {
    title: "Featured Products",
    subtitle: "Explore our latest arrivals",
    source: "newest",
    productSlugs: [],
    limit: 8,
    columns: "4",
    showPrice: true,
    showRating: true,
    tone: "default",
  },
  render: V.ProductGridView,
};

// 4. CollectionGrid
export const CollectionGridSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  collectionSlugs: z.array(z.string()).default([]),
  columns: z.enum(["2", "3", "4"]).default("3"),
});
export type CollectionGridProps = z.infer<typeof CollectionGridSchema>;

export const CollectionGridBlock: BlockDefinition<CollectionGridProps> = {
  type: "CollectionGrid",
  version: 1,
  schema: CollectionGridSchema,
  defaultProps: {
    title: "Shop by Category",
    subtitle: "Find exactly what you are looking for",
    collectionSlugs: [],
    columns: "3",
  },
  render: V.CollectionGridView,
};

// 5. ProductCarousel
export const ProductCarouselSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  source: productSourceSchema.optional(),
  collectionSlug: z.string().optional(),
  productSlugs: z.array(z.string().max(220)).max(24).default([]),
  limit: z.number().int().min(1).max(24).default(8),
  autoPlay: z.boolean().default(false),
  columns: z.enum(["2", "3", "4", "5"]).default("4"),
  showPrice: z.boolean().default(true),
  showRating: z.boolean().default(true),
  viewAllLabel: z.string().max(60).optional(),
  viewAllHref: hrefSchema.optional(),
  tone: toneSchema.default("default"),
});
export type ProductCarouselProps = z.infer<typeof ProductCarouselSchema>;

export const ProductCarouselBlock: BlockDefinition<ProductCarouselProps> = {
  type: "ProductCarousel",
  version: 1,
  schema: ProductCarouselSchema,
  defaultProps: {
    title: "Trending Items",
    subtitle: "Best sellers this week",
    source: "featured",
    productSlugs: [],
    limit: 8,
    autoPlay: false,
    columns: "4",
    showPrice: true,
    showRating: true,
    tone: "default",
  },
  render: V.ProductCarouselView,
};

// 6. Testimonials
export const TestimonialsSchema = z.object({
  title: z.string().default("What Our Customers Say"),
  items: z
    .array(
      z.object({
        quote: z.string().min(1),
        author: z.string().min(1),
        role: z.string().optional(),
        avatarMediaId: z.string().optional(),
        rating: z.number().int().min(1).max(5).default(5),
      }),
    )
    .min(1),
  layout: z.enum(["grid", "carousel", "single"]).default("grid"),
  tone: toneSchema.default("surface"),
});
export type TestimonialsProps = z.infer<typeof TestimonialsSchema>;

export const TestimonialsBlock: BlockDefinition<TestimonialsProps> = {
  type: "Testimonials",
  version: 1,
  schema: TestimonialsSchema,
  defaultProps: {
    title: "What Our Customers Say",
    items: [
      {
        quote: "The quality of craftsmanship surpassed my expectations. Will definitely order again!",
        author: "Aarav Sharma",
        role: "Verified Buyer",
        rating: 5,
      },
    ],
    layout: "grid",
    tone: "surface",
  },
  render: V.TestimonialsView,
};

// 7. Reviews
export const ReviewsSchema = z.object({
  title: z.string().default("Customer Reviews"),
  showAggregate: z.boolean().default(true),
  limit: z.number().int().min(1).max(20).default(6),
});
export type ReviewsProps = z.infer<typeof ReviewsSchema>;

export const ReviewsBlock: BlockDefinition<ReviewsProps> = {
  type: "Reviews",
  version: 1,
  schema: ReviewsSchema,
  defaultProps: { title: "Customer Reviews", showAggregate: true, limit: 6 },
  render: V.ReviewsView,
};

// 8. RichText (sanitized HTML only per ADR-009)
export const RichTextSchema = z.object({
  content: z.string().min(1),
  alignment: alignSchema.default("left"),
});
export type RichTextProps = z.infer<typeof RichTextSchema>;

export const RichTextBlock: BlockDefinition<RichTextProps> = {
  type: "RichText",
  version: 1,
  schema: RichTextSchema,
  defaultProps: {
    content:
      "<h2>About Our Craft</h2><p>We pride ourselves on attention to detail, sustainably sourced materials, and enduring design.</p>",
    alignment: "left",
  },
  render: V.RichTextView,
};

// 9. FAQ
export const FAQSchema = z.object({
  title: z.string().default("Frequently Asked Questions"),
  items: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) })).min(1),
});
export type FAQProps = z.infer<typeof FAQSchema>;

export const FAQBlock: BlockDefinition<FAQProps> = {
  type: "FAQ",
  version: 1,
  schema: FAQSchema,
  defaultProps: {
    title: "Frequently Asked Questions",
    items: [
      { question: "How long does shipping take?", answer: "Standard shipping takes 3-5 business days across India." },
      {
        question: "What is your return policy?",
        answer: "We offer hassle-free returns within 7 days of delivery for unused items.",
      },
    ],
  },
  render: V.FaqView,
};

// 10. Gallery
export const GallerySchema = z.object({
  title: z.string().optional(),
  images: z
    .array(z.object({ mediaId: z.string().min(1), caption: z.string().optional(), link: hrefSchema.optional() }))
    .default([]),
  layout: z.enum(["grid", "masonry"]).default("grid"),
});
export type GalleryProps = z.infer<typeof GallerySchema>;

export const GalleryBlock: BlockDefinition<GalleryProps> = {
  type: "Gallery",
  version: 1,
  schema: GallerySchema,
  defaultProps: { title: "Lookbook", images: [], layout: "grid" },
  render: V.GalleryView,
};

// 11. Newsletter
export const NewsletterSchema = z.object({
  title: z.string().default("Subscribe to Our Newsletter"),
  subtitle: z.string().default("Get updates on new releases, special discounts, and seasonal collections."),
  buttonText: z.string().default("Subscribe"),
  placeholder: z.string().default("Enter your email address"),
});
export type NewsletterProps = z.infer<typeof NewsletterSchema>;

export const NewsletterBlock: BlockDefinition<NewsletterProps> = {
  type: "Newsletter",
  version: 1,
  schema: NewsletterSchema,
  defaultProps: {
    title: "Subscribe to Our Newsletter",
    subtitle: "Get updates on new releases, special discounts, and seasonal collections.",
    buttonText: "Subscribe",
    placeholder: "Enter your email address",
  },
  render: V.NewsletterView,
};

// 12. UspStrip
export const UspStripSchema = z.object({
  items: z
    .array(z.object({ icon: z.string().min(1), title: z.string().min(1), description: z.string().min(1) }))
    .min(1),
});
export type UspStripProps = z.infer<typeof UspStripSchema>;

export const UspStripBlock: BlockDefinition<UspStripProps> = {
  type: "UspStrip",
  version: 1,
  schema: UspStripSchema,
  defaultProps: {
    items: [
      { icon: "Truck", title: "Free Shipping", description: "On orders above ₹999 across India" },
      { icon: "ShieldCheck", title: "100% Authentic", description: "Guaranteed genuine quality direct from makers" },
      { icon: "RotateCcw", title: "Easy Returns", description: "7-day seamless exchange & return guarantee" },
      { icon: "Headphones", title: "Dedicated Support", description: "Friendly support via phone and WhatsApp" },
    ],
  },
  render: V.UspStripView,
};

/* ------------------------------------------------------------------ */
/* Layout primitives. Children live in the `content` slot.             */
/* ------------------------------------------------------------------ */

export const SectionSchema = z.object({
  tone: toneSchema.default("default"),
  paddingY: spacingSchema.default("lg"),
  width: widthSchema.default("wide"),
  backgroundMediaId: z.string().optional(),
  overlayOpacity: z.number().min(0).max(100).default(0),
  content: slotSchema,
});
export type SectionProps = z.infer<typeof SectionSchema>;
export const SectionBlock: BlockDefinition<SectionProps> = {
  type: "Section",
  version: 1,
  schema: SectionSchema,
  defaultProps: { tone: "default", paddingY: "lg", width: "wide", overlayOpacity: 0, content: [] },
  render: V.SectionView,
};

export const ContainerSchema = z.object({
  width: widthSchema.default("default"),
  tone: toneSchema.default("default"),
  paddingY: spacingSchema.default("none"),
  align: alignSchema.default("left"),
  content: slotSchema,
});
export type ContainerProps = z.infer<typeof ContainerSchema>;
export const ContainerBlock: BlockDefinition<ContainerProps> = {
  type: "Container",
  version: 1,
  schema: ContainerSchema,
  defaultProps: { width: "default", tone: "default", paddingY: "none", align: "left", content: [] },
  render: V.ContainerView,
};

export const GridSchema = z.object({
  columns: z.number().int().min(1).max(6).default(3),
  columnsMobile: z.number().int().min(1).max(2).default(1),
  gap: gapSchema.default("md"),
  content: slotSchema,
});
export type GridProps = z.infer<typeof GridSchema>;
export const GridBlock: BlockDefinition<GridProps> = {
  type: "Grid",
  version: 1,
  schema: GridSchema,
  defaultProps: { columns: 3, columnsMobile: 1, gap: "md", content: [] },
  render: V.GridView,
};

export const FlexRowSchema = z.object({
  gap: gapSchema.default("md"),
  alignItems: itemsSchema.default("stretch"),
  justify: justifySchema.default("start"),
  content: slotSchema,
});
export type FlexRowProps = z.infer<typeof FlexRowSchema>;
export const FlexRowBlock: BlockDefinition<FlexRowProps> = {
  type: "FlexRow",
  version: 1,
  schema: FlexRowSchema,
  defaultProps: { gap: "md", alignItems: "stretch", justify: "start", content: [] },
  render: V.FlexRowView,
};

export const FlexColumnSchema = z.object({
  gap: gapSchema.default("sm"),
  alignItems: itemsSchema.default("stretch"),
  content: slotSchema,
});
export type FlexColumnProps = z.infer<typeof FlexColumnSchema>;
export const FlexColumnBlock: BlockDefinition<FlexColumnProps> = {
  type: "FlexColumn",
  version: 1,
  schema: FlexColumnSchema,
  defaultProps: { gap: "sm", alignItems: "stretch", content: [] },
  render: V.FlexColumnView,
};

export const SpacerSchema = z.object({ size: z.enum(["sm", "md", "lg", "xl"]).default("md") });
export type SpacerProps = z.infer<typeof SpacerSchema>;
export const SpacerBlock: BlockDefinition<SpacerProps> = {
  type: "Spacer",
  version: 1,
  schema: SpacerSchema,
  defaultProps: { size: "md" },
  render: V.SpacerView,
};

export const DividerSchema = z.object({ width: widthSchema.default("default") });
export type DividerProps = z.infer<typeof DividerSchema>;
export const DividerBlock: BlockDefinition<DividerProps> = {
  type: "Divider",
  version: 1,
  schema: DividerSchema,
  defaultProps: { width: "default" },
  render: V.DividerView,
};

/* ------------------------------------------------------------------ */
/* Content primitives                                                  */
/* ------------------------------------------------------------------ */

export const HeadingSchema = z.object({
  text: z.string().min(1).max(300),
  level: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]).default("h2"),
  // "auto" follows the heading level's size from the theme settings; the others keep the older fixed steps.
  size: z.enum(["sm", "md", "lg", "xl", "auto"]).default("lg"),
  align: alignSchema.default("left"),
});
export type HeadingProps = z.infer<typeof HeadingSchema>;
export const HeadingBlock: BlockDefinition<HeadingProps> = {
  type: "Heading",
  version: 1,
  schema: HeadingSchema,
  defaultProps: { text: "Heading", level: "h2", size: "lg", align: "left" },
  render: V.HeadingView,
};

export const TextSchema = z.object({
  text: z.string().min(1).max(5000),
  align: alignSchema.default("left"),
  muted: z.boolean().default(false),
});
export type TextProps = z.infer<typeof TextSchema>;
export const TextBlock: BlockDefinition<TextProps> = {
  type: "Text",
  version: 1,
  schema: TextSchema,
  defaultProps: { text: "Write something helpful for your customers.", align: "left", muted: false },
  render: V.TextView,
};

export const ImageSchema = z.object({
  mediaId: z.string().optional(),
  alt: z.string().max(300).default(""),
  ratio: z.enum(["auto", "square", "4-3", "16-9"]).default("auto"),
  rounded: z.boolean().default(false),
  href: hrefSchema.optional(),
});
export type ImageProps = z.infer<typeof ImageSchema>;
export const ImageBlock: BlockDefinition<ImageProps> = {
  type: "Image",
  version: 1,
  schema: ImageSchema,
  defaultProps: { alt: "", ratio: "auto", rounded: false },
  render: V.ImageView,
};

export const VideoSchema = z.object({ url: videoUrlSchema.default("") });
export type VideoProps = z.infer<typeof VideoSchema>;
export const VideoBlock: BlockDefinition<VideoProps> = {
  type: "Video",
  version: 1,
  schema: VideoSchema,
  defaultProps: { url: "" },
  render: V.VideoView,
};

export const ButtonSchema = z.object({
  label: z.string().min(1).max(80),
  href: hrefSchema.default("/"),
  variant: z.enum(["primary", "secondary", "outline"]).default("primary"),
  // "auto" follows the theme's button size; the others are fixed sizes.
  size: z.enum(["auto", "sm", "md", "lg"]).default("md"),
  fullWidth: z.boolean().default(false),
  align: alignSchema.default("left"),
});
export type ButtonProps = z.infer<typeof ButtonSchema>;
export const ButtonBlock: BlockDefinition<ButtonProps> = {
  type: "Button",
  version: 1,
  schema: ButtonSchema,
  defaultProps: { label: "Shop now", href: "/collections/all", variant: "primary", size: "auto", fullWidth: false, align: "left" },
  render: V.ButtonView,
};

export const IconSchema = z.object({
  name: z.enum(ICON_NAMES).default("star"),
  size: z.enum(["sm", "md", "lg"]).default("md"),
  align: alignSchema.default("left"),
});
export type IconProps = z.infer<typeof IconSchema>;
export const IconBlock: BlockDefinition<IconProps> = {
  type: "Icon",
  version: 1,
  schema: IconSchema,
  defaultProps: { name: "star", size: "md", align: "left" },
  render: V.IconView,
};

export const LinkSchema = z.object({
  label: z.string().min(1).max(120),
  href: hrefSchema.default("/"),
  newTab: z.boolean().default(false),
});
export type LinkProps = z.infer<typeof LinkSchema>;
export const LinkBlock: BlockDefinition<LinkProps> = {
  type: "Link",
  version: 1,
  schema: LinkSchema,
  defaultProps: { label: "Learn more", href: "/", newTab: false },
  render: V.LinkView,
};

/* ------------------------------------------------------------------ */
/* Conversion widgets                                                  */
/* ------------------------------------------------------------------ */

export const CallToActionSchema = z.object({
  heading: z.string().min(1).max(200),
  text: z.string().max(600).optional(),
  primaryLabel: z.string().max(80).optional(),
  primaryHref: hrefSchema.optional(),
  secondaryLabel: z.string().max(80).optional(),
  secondaryHref: hrefSchema.optional(),
  backgroundMediaId: z.string().optional(),
  overlayOpacity: z.number().min(0).max(100).default(45),
  tone: toneSchema.default("primary"),
  align: alignSchema.default("center"),
});
export type CallToActionProps = z.infer<typeof CallToActionSchema>;
export const CallToActionBlock: BlockDefinition<CallToActionProps> = {
  type: "CallToAction",
  version: 1,
  schema: CallToActionSchema,
  defaultProps: {
    heading: "Ready to order?",
    text: "Join thousands of happy customers.",
    primaryLabel: "Shop now",
    primaryHref: "/collections/all",
    overlayOpacity: 45,
    tone: "primary",
    align: "center",
  },
  render: V.CallToActionView,
};

/* ------------------------------------------------------------------ */
/* Store chrome and page cores. Header/footer live on the theme's own  */
/* pages; ProductDetail / CollectionListing are the dynamic core of    */
/* the product and collection pages, drawn by the storefront.          */
/* ------------------------------------------------------------------ */

const DEFAULT_TRUST_POINTS = ["Secure checkout", "Easy returns", "Fast dispatch"];

const navLinkSchema = z.object({ label: z.string().min(1).max(60), href: hrefSchema });

export const SiteHeaderSchema = z.object({
  menuHandle: z.string().optional(),
  links: z.array(navLinkSchema).max(8).default([]),
  logoText: z.string().max(60).optional(),
  logoMediaId: z.string().optional(),
  layout: z.enum(["left", "center"]).default("left"),
  showSearch: z.boolean().default(true),
  showCart: z.boolean().default(true),
  sticky: z.boolean().default(true),
  tone: toneSchema.default("default"),
});
export type SiteHeaderProps = z.infer<typeof SiteHeaderSchema>;
export const SiteHeaderBlock: BlockDefinition<SiteHeaderProps> = {
  type: "SiteHeader",
  version: 1,
  schema: SiteHeaderSchema,
  defaultProps: {
    menuHandle: "header",
    links: [
      { label: "Home", href: "/" },
      { label: "Shop", href: "/collections/all" },
      { label: "About", href: "/pages/about" },
    ],
    layout: "left",
    showSearch: true,
    showCart: true,
    sticky: true,
    tone: "default",
  },
  render: V.SiteHeaderView,
};

export const SiteFooterSchema = z.object({
  about: z.string().max(300).optional(),
  columns: z
    .array(
      z.object({
        title: z.string().min(1).max(60),
        menuHandle: z.string().optional(),
        links: z.array(navLinkSchema).max(8).default([]),
      }),
    )
    .max(4)
    .default([]),
  showNewsletter: z.boolean().default(true),
  newsletterTitle: z.string().max(80).default("Newsletter"),
  newsletterText: z.string().max(200).default("Subscribe for updates and exclusive offers."),
  copyright: z.string().max(200).optional(),
  tone: toneSchema.default("surface"),
});
export type SiteFooterProps = z.infer<typeof SiteFooterSchema>;
export const SiteFooterBlock: BlockDefinition<SiteFooterProps> = {
  type: "SiteFooter",
  version: 1,
  schema: SiteFooterSchema,
  defaultProps: {
    about: "Quality products, delivered with care.",
    columns: [
      { title: "Shop", links: [{ label: "All products", href: "/collections/all" }, { label: "Search", href: "/search" }] },
      {
        title: "Policies",
        links: [
          { label: "Privacy Policy", href: "/policies/privacy" },
          { label: "Terms of Service", href: "/policies/terms" },
          { label: "Refund Policy", href: "/policies/refund" },
          { label: "Shipping Policy", href: "/policies/shipping" },
        ],
      },
    ],
    showNewsletter: true,
    newsletterTitle: "Newsletter",
    newsletterText: "Subscribe for updates and exclusive offers.",
    tone: "surface",
  },
  render: V.SiteFooterView,
};

export const ProductDetailSchema = z.object({
  galleryPosition: z.enum(["left", "right"]).default("left"),
  showBreadcrumb: z.boolean().default(true),
  showRating: z.boolean().default(true),
  showDescription: z.boolean().default(true),
  showTags: z.boolean().default(true),
  stickyBuyBox: z.boolean().default(false),
  showTrustPoints: z.boolean().default(false),
  trustPoints: z.array(z.string().min(1).max(60)).max(4).default(DEFAULT_TRUST_POINTS),
  stickyMobileBar: z.boolean().default(false),
  showSku: z.boolean().default(true),
});
export type ProductDetailProps = z.infer<typeof ProductDetailSchema>;
export const ProductDetailBlock: BlockDefinition<ProductDetailProps> = {
  type: "ProductDetail",
  version: 1,
  schema: ProductDetailSchema,
  defaultProps: { galleryPosition: "left", showBreadcrumb: true, showRating: true, showDescription: true, showTags: true, stickyBuyBox: false, showTrustPoints: false, trustPoints: DEFAULT_TRUST_POINTS, stickyMobileBar: false, showSku: true },
  render: V.ProductDetailView,
};

export const CollectionListingSchema = z.object({
  columns: z.enum(["2", "3", "4"]).default("4"),
  showFilters: z.boolean().default(true),
  showDescription: z.boolean().default(true),
  columnsMobile: z.enum(["1", "2"]).default("1"),
  imageRatio: z.enum(["square", "portrait"]).default("square"),
  cardStyle: z.enum(["bordered", "minimal"]).default("bordered"),
  showSaleBadge: z.boolean().default(true),
  showRatings: z.boolean().default(true),
  showBreadcrumb: z.boolean().default(true),
  filterMenuHandle: z.string().optional(),
});
export type CollectionListingProps = z.infer<typeof CollectionListingSchema>;
export const CollectionListingBlock: BlockDefinition<CollectionListingProps> = {
  type: "CollectionListing",
  version: 1,
  schema: CollectionListingSchema,
  defaultProps: { columns: "4", showFilters: true, showDescription: true, columnsMobile: "1", imageRatio: "square", cardStyle: "bordered", showSaleBadge: true, showRatings: true, showBreadcrumb: true },
  render: V.CollectionListingView,
};

// The cart page's core: items, totals, discount code and checkout button stay in storefront code
// (prices are recomputed on the server, rule 12); the template only places it and picks its layout.
export const CartContentsSchema = z.object({
  summaryPosition: z.enum(["right", "left"]).default("right"),
  stickySummary: z.boolean().default(true),
  showDiscountCode: z.boolean().default(true),
  showShippingEstimator: z.boolean().default(true),
  heading: z.string().min(1).max(60).default("Shopping Cart"),
  checkoutLabel: z.string().min(1).max(40).default("Proceed to Checkout"),
  showFreeShippingBar: z.boolean().default(false),
  showTrustPoints: z.boolean().default(false),
  trustPoints: z.array(z.string().min(1).max(60)).max(4).default(DEFAULT_TRUST_POINTS),
  stickyMobileCheckout: z.boolean().default(false),
  showContinueShopping: z.boolean().default(true),
});
export type CartContentsProps = z.infer<typeof CartContentsSchema>;
export const CartContentsBlock: BlockDefinition<CartContentsProps> = {
  type: "CartContents",
  version: 1,
  schema: CartContentsSchema,
  defaultProps: {
    summaryPosition: "right",
    stickySummary: true,
    showDiscountCode: true,
    showShippingEstimator: true,
    heading: "Shopping Cart",
    checkoutLabel: "Proceed to Checkout",
    showFreeShippingBar: false,
    showTrustPoints: false,
    trustPoints: DEFAULT_TRUST_POINTS,
    stickyMobileCheckout: false,
    showContinueShopping: true,
  },
  render: V.CartContentsView,
};

/* ------------------------------------------------------------------ */
/* Hero slider: full-width slides with image or video backgrounds, a    */
/* bottom shade, two buttons, optional autoplay / dots / arrows.        */
/* ------------------------------------------------------------------ */

export const HeroSlideSchema = z.object({
  backgroundMediaId: z.string().optional(),
  // A background video plays over the image, which stays as its poster (and as the fallback on slow or reduced-motion connections).
  videoUrl: bgVideoUrlSchema.optional(),
  title: z.string().max(160).default(""),
  subtitle: z.string().max(400).default(""),
  primaryLabel: z.string().max(40).default(""),
  primaryHref: hrefSchema.default(""),
  secondaryLabel: z.string().max(40).default(""),
  secondaryHref: hrefSchema.default(""),
});
export type HeroSlide = z.infer<typeof HeroSlideSchema>;

const DEFAULT_SLIDES: HeroSlide[] = [
  {
    title: "Pure quality, delivered with care",
    subtitle: "Small-batch products from makers you can trust.",
    primaryLabel: "Shop now",
    primaryHref: "/collections/all",
    secondaryLabel: "Our story",
    secondaryHref: "/pages/about",
  },
];

export const HeroSliderSchema = z.object({
  slides: z.array(HeroSlideSchema).min(1).max(6).default(DEFAULT_SLIDES),
  // Layout
  layout: z.enum(["split", "stacked"]).default("split"), // split: text left, buttons right; stacked: text, then buttons
  align: alignSchema.default("left"), // for the stacked layout
  contentPosition: z.enum(["bottom", "center"]).default("bottom"),
  height: z.enum(["sm", "md", "lg", "screen"]).default("md"),
  contentWidth: z.enum(["default", "wide", "full"]).default("wide"),
  titleSize: z.enum(["lg", "xl"]).default("lg"),
  titleTag: z.enum(["h1", "h2"]).default("h2"), // first slide only; the others are always h2
  // Image and shade
  dim: z.number().int().min(0).max(80).default(0), // overall darkening, %
  shade: z.boolean().default(true), // gradient from the bottom edge
  shadeStrength: z.number().int().min(0).max(100).default(70),
  shadeHeight: z.enum(["sm", "md", "lg"]).default("md"),
  // Buttons
  buttonSize: z.enum(["auto", "sm", "md", "lg"]).default("auto"),
  primaryStyle: z.enum(["dark", "light", "outline"]).default("dark"),
  secondaryStyle: z.enum(["dark", "light", "outline"]).default("light"),
  primaryBg: hexColorSchema.optional(),
  primaryText: hexColorSchema.optional(),
  secondaryBg: hexColorSchema.optional(),
  secondaryText: hexColorSchema.optional(),
  // Margin, padding and sizing per device (default: none, edge to edge, as before)
  box: layoutSchema.default({}),
  // Behaviour
  autoplay: z.boolean().default(true),
  interval: z.number().int().min(2).max(20).default(6),
  loop: z.boolean().default(true),
  pauseOnHover: z.boolean().default(true),
  // Pagination dots
  dots: z.boolean().default(true),
  dotsStyle: z.enum(["dot", "pill", "line"]).default("dot"),
  dotsSize: z.enum(["sm", "md", "lg"]).default("md"),
  dotsColor: z.enum(["light", "dark", "brand"]).default("light"),
  dotsPosition: z.enum(["left", "center", "right"]).default("center"),
  // Arrows
  arrows: z.boolean().default(true),
  arrowStyle: z.enum(["circle", "square", "plain"]).default("circle"),
  arrowSize: z.enum(["sm", "md", "lg"]).default("md"),
  arrowColor: z.enum(["light", "dark", "brand"]).default("light"),
  arrowsOnMobile: z.boolean().default(false),
});
export type HeroSliderProps = z.infer<typeof HeroSliderSchema>;

export const HeroSliderBlock: BlockDefinition<HeroSliderProps> = {
  type: "HeroSlider",
  version: 1,
  schema: HeroSliderSchema,
  defaultProps: HeroSliderSchema.parse({}),
  render: V.HeroSliderView,
};

/* ------------------------------------------------------------------ */
/* Product showcase: a product carousel with optional collection tabs,  */
/* a configurable card (order and visibility of rating, title, price),  */
/* quick add to cart, arrows and pagination dots.                       */
/* ------------------------------------------------------------------ */

export const ShowcaseTabSchema = z.object({
  label: z.string().max(40).default(""),
  source: z.enum(["newest", "featured", "collection"]).default("collection"),
  collectionSlug: z.string().max(120).default(""),
});
export type ShowcaseTab = z.infer<typeof ShowcaseTabSchema>;

export const ShowcaseCardItemSchema = z.object({
  item: z.enum(["rating", "title", "price"]),
  show: z.boolean().default(true),
});
export type ShowcaseCardItem = z.infer<typeof ShowcaseCardItemSchema>;

const DEFAULT_CARD_ORDER: ShowcaseCardItem[] = [
  { item: "rating", show: true },
  { item: "title", show: true },
  { item: "price", show: true },
];

export const ProductShowcaseSchema = z.object({
  title: z.string().max(120).default("Fresh from the collection"),
  subtitle: z.string().max(300).default(""),
  headerAlign: alignSchema.default("left"),
  tone: toneSchema.default("default"),
  // Products. More than one tab turns the tab bar on; one tab shows no tabs.
  tabs: z.array(ShowcaseTabSchema).min(1).max(6).default([{ label: "New arrivals", source: "newest", collectionSlug: "" }]),
  limit: z.number().int().min(2).max(24).default(10),
  tabsStyle: z.enum(["text", "pill"]).default("text"),
  // Card: the order of the rows below the image is the order of this list (drag to reorder in the editor).
  cardOrder: z.array(ShowcaseCardItemSchema).min(1).max(3).default(DEFAULT_CARD_ORDER),
  badge: z.enum(["none", "category", "brand"]).default("category"),
  showSaleBadge: z.boolean().default(true),
  showCompareAt: z.boolean().default(true),
  startsFrom: z.enum(["auto", "always", "never"]).default("auto"),
  showAddToCart: z.boolean().default(true),
  imageRatio: z.enum(["square", "portrait", "landscape"]).default("square"),
  cardStyle: z.enum(["soft", "bordered", "minimal"]).default("soft"),
  titleSize: z.enum(["sm", "md", "lg"]).default("md"),
  titleLines: z.enum(["1", "2"]).default("1"),
  priceSize: z.enum(["sm", "md", "lg"]).default("md"),
  // Margin, padding and sizing per device. The defaults are the section padding it always had (64px, 48px on phones).
  box: layoutSchema.default({ desktop: { paddingTop: "64px", paddingBottom: "64px" }, mobile: { paddingTop: "48px", paddingBottom: "48px" } }),
  // Layout: cards visible at once on each device
  perViewDesktop: z.number().int().min(2).max(6).default(4),
  perViewTablet: z.number().int().min(1).max(4).default(3),
  perViewMobile: z.number().int().min(1).max(3).default(2),
  gap: z.enum(["sm", "md", "lg"]).default("md"),
  // Autoplay
  autoplay: z.boolean().default(false),
  interval: z.number().int().min(2).max(20).default(5),
  loop: z.boolean().default(true),
  pauseOnHover: z.boolean().default(true),
  // Arrows
  arrows: z.boolean().default(true),
  arrowStyle: z.enum(["circle", "square", "plain"]).default("circle"),
  arrowSize: z.enum(["sm", "md", "lg"]).default("md"),
  arrowColor: z.enum(["light", "dark", "brand"]).default("light"),
  arrowsOnMobile: z.boolean().default(false),
  // Pagination dots
  dots: z.boolean().default(true),
  dotsStyle: z.enum(["dot", "pill", "line"]).default("dot"),
  dotsSize: z.enum(["sm", "md", "lg"]).default("md"),
  dotsColor: z.enum(["light", "dark", "brand"]).default("dark"),
  dotsPosition: z.enum(["left", "center", "right"]).default("center"),
});
export type ProductShowcaseProps = z.infer<typeof ProductShowcaseSchema>;

export const ProductShowcaseBlock: BlockDefinition<ProductShowcaseProps> = {
  type: "ProductShowcase",
  version: 1,
  schema: ProductShowcaseSchema,
  defaultProps: ProductShowcaseSchema.parse({}),
  render: V.ProductShowcaseView,
};

export { type BlockType } from "./types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyBlockDefinition = BlockDefinition<any>;

// Registry Map
export const BLOCK_DEFINITIONS: Record<BlockType, AnyBlockDefinition> = {
  Hero: HeroBlock,
  Banner: BannerBlock,
  ProductGrid: ProductGridBlock,
  CollectionGrid: CollectionGridBlock,
  ProductCarousel: ProductCarouselBlock,
  Testimonials: TestimonialsBlock,
  Reviews: ReviewsBlock,
  RichText: RichTextBlock,
  FAQ: FAQBlock,
  Gallery: GalleryBlock,
  Newsletter: NewsletterBlock,
  UspStrip: UspStripBlock,
  Section: SectionBlock,
  Container: ContainerBlock,
  Grid: GridBlock,
  FlexRow: FlexRowBlock,
  FlexColumn: FlexColumnBlock,
  Spacer: SpacerBlock,
  Divider: DividerBlock,
  Heading: HeadingBlock,
  Text: TextBlock,
  Image: ImageBlock,
  Video: VideoBlock,
  Button: ButtonBlock,
  Icon: IconBlock,
  Link: LinkBlock,
  CallToAction: CallToActionBlock,
  SiteHeader: SiteHeaderBlock,
  SiteFooter: SiteFooterBlock,
  ProductDetail: ProductDetailBlock,
  CollectionListing: CollectionListingBlock,
  CartContents: CartContentsBlock,
  HeroSlider: HeroSliderBlock,
  ProductShowcase: ProductShowcaseBlock,
};

export const BLOCK_TYPES = Object.keys(BLOCK_DEFINITIONS) as BlockType[];

export function getBlockDefinition(type: "Hero"): BlockDefinition<HeroProps>;
export function getBlockDefinition(type: "Banner"): BlockDefinition<BannerProps>;
export function getBlockDefinition(type: "ProductGrid"): BlockDefinition<ProductGridProps>;
export function getBlockDefinition(type: "CollectionGrid"): BlockDefinition<CollectionGridProps>;
export function getBlockDefinition(type: "ProductCarousel"): BlockDefinition<ProductCarouselProps>;
export function getBlockDefinition(type: "Testimonials"): BlockDefinition<TestimonialsProps>;
export function getBlockDefinition(type: "Reviews"): BlockDefinition<ReviewsProps>;
export function getBlockDefinition(type: "RichText"): BlockDefinition<RichTextProps>;
export function getBlockDefinition(type: "FAQ"): BlockDefinition<FAQProps>;
export function getBlockDefinition(type: "Gallery"): BlockDefinition<GalleryProps>;
export function getBlockDefinition(type: "Newsletter"): BlockDefinition<NewsletterProps>;
export function getBlockDefinition(type: "UspStrip"): BlockDefinition<UspStripProps>;
export function getBlockDefinition(type: BlockType): AnyBlockDefinition;
export function getBlockDefinition(type: BlockType): AnyBlockDefinition {
  const def = BLOCK_DEFINITIONS[type];
  if (!def) {
    throw new Error(`Unknown block type: "${type}"`);
  }
  return def;
}
