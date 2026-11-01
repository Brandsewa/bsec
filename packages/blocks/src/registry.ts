import { z } from "zod";
import type { BlockDefinition, BlockType } from "./types.ts";
import {
  alignSchema,
  bgVideoUrlSchema,
  hexColorSchema,
  gapSchema,
  hrefSchema,
  httpsImageUrlSchema,
  logoSizeSchema,
  iconNameSchema,
  itemsSchema,
  justifySchema,
  slotSchema,
  spacingSchema,
  toneSchema,
  videoUrlSchema,
  widthSchema,
} from "./common.ts";
import { layoutSchema, slideRadiusSchema } from "./layout.ts";
import { bricksLayoutSchema, BRICKS_OBJECT_FIT_OPTIONS } from "./bricks-layout.ts";
import * as V from "./views.tsx";
import * as VB from "./views-blog.tsx";
import * as VR from "./views-reviews.tsx";
import * as VI from "./views-image-banner.tsx";
import * as VF from "./views-faq.tsx";
import { PRODUCT_ELEMENTS } from "./product-elements.ts";
import * as VC from "./views-collection-showcase.tsx";
import * as VT from "./views-trust-strip.tsx";
import * as VM from "./views-multi-card.tsx";

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
  /** More messages after `text`; with two or more the bar rotates through them (CSS only, pauses on hover). */
  messages: z
    .array(z.object({ text: z.string().min(1).max(200), link: hrefSchema.optional() }))
    .max(5)
    .default([]),
  rotate: z.boolean().default(true),
  /** Seconds each message stays. */
  interval: z.number().int().min(2).max(20).default(5),
  align: alignSchema.default("center"),
  /** Colours: empty uses the theme's brand colours. */
  bgColor: hexColorSchema.optional(),
  textColor: hexColorSchema.optional(),
  fontSize: z.number().int().min(11).max(22).default(14),
  fontWeight: z.enum(["400", "500", "600", "700"]).default("500"),
  font: z.enum(["body", "heading"]).default("body"),
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
    messages: [],
    rotate: true,
    interval: 5,
    align: "center",
    fontSize: 14,
    fontWeight: "500",
    font: "body",
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
  /** Where the heading and the description sit: left, centre (the original look) or right. */
  headerAlign: alignSchema.default("center"),
  collectionSlugs: z.array(z.string()).default([]),
  /** List every published collection (the Collection Archive page), ignoring collectionSlugs. */
  showAll: z.boolean().default(false),
  /** Set by the storefront on /categories so the same archive template lists categories; not an editor setting. */
  source: z.enum(["collections", "categories"]).default("collections"),
  /** Cards per row on desktop (1024px and up). */
  columns: z.enum(["2", "3", "4"]).default("3"),
  /** Cards per row on tablets (640 to 1023px). */
  columnsTablet: z.enum(["1", "2"]).default("2"),
  /** Cards per row on phones (under 640px). */
  columnsMobile: z.enum(["1", "2"]).default("1"),
});
export type CollectionGridProps = z.infer<typeof CollectionGridSchema>;

export const CollectionGridBlock: BlockDefinition<CollectionGridProps> = {
  type: "CollectionGrid",
  version: 1,
  schema: CollectionGridSchema,
  defaultProps: {
    title: "Shop by Category",
    subtitle: "Find exactly what you are looking for",
    headerAlign: "center",
    collectionSlugs: [],
    showAll: false,
    source: "collections",
    columns: "3",
    columnsTablet: "2",
    columnsMobile: "1",
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
  ...bricksLayoutSchema.shape,
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
  /** Text under the heading. */
  description: z.string().max(400).optional(),
  /** Alignment of the heading and the description. */
  headerAlign: z.enum(["left", "center", "right"]).default("center"),
  /** Space between the heading and the description, px. */
  titleGap: z.number().int().min(0).max(80).default(8),
  /** Space between the heading or description and the pictures, px. */
  headerGap: z.number().int().min(0).max(120).default(24),
  images: z
    .array(z.object({ mediaId: z.string().min(1), caption: z.string().optional(), link: hrefSchema.optional() }))
    .default([]),
  layout: z.enum(["grid", "masonry"]).default("masonry"),
  /** Images per row on desktop, tablet and phone. */
  columnsDesktop: z.enum(["2", "3", "4", "5", "6"]).default("4"),
  columnsTablet: z.enum(["1", "2", "3", "4"]).default("3"),
  columnsMobile: z.enum(["1", "2", "3"]).default("2"),
  /** Space between images, px. */
  gap: z.number().int().min(0).max(48).default(12),
  /** Corner radius of each image, px. */
  radius: z.number().int().min(0).max(48).default(8),
  /** auto: every image keeps its own shape. manual: all images are cut to `manualHeight`. */
  heightMode: z.enum(["auto", "manual"]).default("auto"),
  manualHeight: z.number().int().min(80).max(800).default(240),
  /** Open the picture in a viewer with arrows and a thumbnail strip. */
  lightbox: z.boolean().default(true),
});
export type GalleryProps = z.infer<typeof GallerySchema>;

export const GalleryBlock: BlockDefinition<GalleryProps> = {
  type: "Gallery",
  version: 1,
  schema: GallerySchema,
  // No sample heading: a new gallery shows only its pictures until the merchant writes one.
  defaultProps: GallerySchema.parse({}),
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

export const SectionSchema = bricksLayoutSchema.extend({
  tone: toneSchema.default("default").optional(),
  paddingY: spacingSchema.default("lg").optional(),
  width: widthSchema.default("wide").optional(),
  backgroundMediaId: z.string().optional(),
  overlayOpacity: z.number().min(0).max(100).default(0).optional(),
  content: slotSchema,
});
export type SectionProps = z.infer<typeof SectionSchema>;
export const SectionBlock: BlockDefinition<SectionProps> = {
  type: "Section",
  version: 1,
  schema: SectionSchema,
  defaultProps: { content: [] },
  render: V.SectionView,
};

export const ContainerSchema = bricksLayoutSchema.extend({
  width: widthSchema.default("default").optional(),
  tone: toneSchema.default("default").optional(),
  paddingY: spacingSchema.default("none").optional(),
  align: alignSchema.default("left").optional(),
  content: slotSchema,
});
export type ContainerProps = z.infer<typeof ContainerSchema>;
export const ContainerBlock: BlockDefinition<ContainerProps> = {
  type: "Container",
  version: 1,
  schema: ContainerSchema,
  defaultProps: { content: [] },
  render: V.ContainerView,
};

export const BlockSchema = bricksLayoutSchema.extend({
  content: slotSchema,
});
export type BlockProps = z.infer<typeof BlockSchema>;
export const BlockBlock: BlockDefinition<BlockProps> = {
  type: "Block",
  version: 1,
  schema: BlockSchema,
  defaultProps: { content: [] },
  render: V.BlockView,
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
  // Legacy size field kept optional for backward compatibility
  size: z.enum(["sm", "md", "lg", "xl", "auto"]).default("auto").optional(),
  align: alignSchema.default("left"),
  link: hrefSchema.optional(),
  ...bricksLayoutSchema.shape,
});
export type HeadingProps = z.infer<typeof HeadingSchema>;
export const HeadingBlock: BlockDefinition<HeadingProps> = {
  type: "Heading",
  version: 1,
  schema: HeadingSchema,
  defaultProps: { text: "Heading", level: "h2", size: "auto", align: "left" },
  render: V.HeadingView,
};

export const TextSchema = z.object({
  text: z.string().min(1).max(5000),
  tag: z.enum(["p", "div", "span"]).default("p"),
  align: alignSchema.default("left"),
  muted: z.boolean().default(false),
  link: hrefSchema.optional(),
  ...bricksLayoutSchema.shape,
});
export type TextProps = z.infer<typeof TextSchema>;
export const TextBlock: BlockDefinition<TextProps> = {
  type: "Text",
  version: 1,
  schema: TextSchema,
  defaultProps: { text: "Write something helpful for your customers.", tag: "p", align: "left", muted: false },
  render: V.TextView,
};

export const ImageSchema = z.object({
  mediaId: z.string().optional(),
  imageUrl: httpsImageUrlSchema.optional().or(z.literal("")),
  alt: z.string().max(300).default(""),
  ratio: z.enum(["auto", "square", "4-3", "16-9"]).default("auto"),
  objectFit: z.enum(BRICKS_OBJECT_FIT_OPTIONS).optional().default("cover"),
  objectPosition: z.string().optional().default("center center"),
  rounded: z.boolean().default(false),
  href: hrefSchema.optional(),
  ...bricksLayoutSchema.shape,
});
export type ImageProps = z.infer<typeof ImageSchema>;
export const ImageBlock: BlockDefinition<ImageProps> = {
  type: "Image",
  version: 1,
  schema: ImageSchema,
  defaultProps: { alt: "", ratio: "auto", objectFit: "cover", objectPosition: "center center", rounded: false },
  render: V.ImageView,
};

export const VideoSchema = z.object({
  videoType: z.enum(["youtube", "vimeo", "media", "url"]).default("youtube"),
  url: videoUrlSchema.default(""),
  mediaId: z.string().uuid().optional().or(z.literal("")),
  posterMediaId: z.string().uuid().optional().or(z.literal("")),
  autoplayLoop: z.boolean().default(false),
  controls: z.boolean().default(true),
  aspectRatio: z.string().optional(),
  objectFit: z.enum(BRICKS_OBJECT_FIT_OPTIONS).default("cover"),
  objectPosition: z.string().default("center center"),
  ...bricksLayoutSchema.shape,
});
export type VideoProps = z.infer<typeof VideoSchema>;
export const VideoBlock: BlockDefinition<VideoProps> = {
  type: "Video",
  version: 1,
  schema: VideoSchema,
  defaultProps: { videoType: "youtube", url: "", autoplayLoop: false, controls: true, objectFit: "cover", objectPosition: "center center" },
  render: V.VideoView,
};

export const FileDownloadSchema = z.object({
  label: z.string().min(1).max(100).default("Download file"),
  description: z.string().max(300).optional().default(""),
  mediaId: z.string().uuid().optional().or(z.literal("")),
});
export type FileDownloadProps = z.infer<typeof FileDownloadSchema>;
export const FileDownloadBlock: BlockDefinition<FileDownloadProps> = {
  type: "FileDownload",
  version: 1,
  schema: FileDownloadSchema,
  defaultProps: { label: "Download file", description: "", mediaId: "" },
  render: V.FileDownloadView,
};

export const ButtonSchema = z.object({
  // Labels & Links (text/link preferred with fallback to legacy label/href)
  label: z.string().min(1).max(80).default("Button"),
  text: z.string().max(80).optional(),
  href: hrefSchema.default("/"),
  link: hrefSchema.optional(),
  newTab: z.boolean().default(false),

  // Style Type & Theme Preset
  styleType: z.enum(["theme", "normal", "line", "text"]).default("theme"),
  variant: z.enum(["primary", "secondary", "outline"]).default("primary"),
  size: z.enum(["auto", "sm", "md", "lg"]).default("auto"),
  fullWidth: z.boolean().default(false),
  align: alignSchema.default("left"),

  // Custom Colors
  buttonColor: hexColorSchema.optional().or(z.literal("")),
  textColor: hexColorSchema.optional().or(z.literal("")),
  hoverButtonColor: hexColorSchema.optional().or(z.literal("")),
  hoverTextColor: hexColorSchema.optional().or(z.literal("")),

  // Icon support
  icon: z.string().optional(),
  iconPosition: z.enum(["left", "right"]).default("left"),
  iconGap: z.string().optional(),

  ...bricksLayoutSchema.shape,
});
export type ButtonProps = z.infer<typeof ButtonSchema>;
export const ButtonBlock: BlockDefinition<ButtonProps> = {
  type: "Button",
  version: 1,
  schema: ButtonSchema,
  defaultProps: {
    label: "Click here",
    text: "Click here",
    href: "/collections/all",
    link: "/collections/all",
    newTab: false,
    styleType: "theme",
    variant: "primary",
    size: "auto",
    fullWidth: false,
    align: "left",
    icon: "none",
    iconPosition: "left",
    iconGap: "8px",
  },
  render: V.ButtonView,
};

export const IconSchema = z.object({
  name: iconNameSchema.default("star"),
  /** Unset or "theme": the theme's icon size. A size here wins over the theme. */
  size: z.enum(["theme", "sm", "md", "lg"]).optional(),
  align: alignSchema.default("left"),
});
export type IconProps = z.infer<typeof IconSchema>;
export const IconBlock: BlockDefinition<IconProps> = {
  type: "Icon",
  version: 1,
  schema: IconSchema,
  defaultProps: { name: "star", align: "left" },
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
  logoSize: logoSizeSchema,
  /**
   * left: logo then menu on the left, icons right. navCenter: logo left, menu in the middle, icons right.
   * logoCenter: menu left, logo in the middle, icons right. logoRight: icons left, menu, logo right.
   * center: logo in the middle with the menu on a row below (stacked).
   */
  layout: z.enum(["left", "navCenter", "logoCenter", "logoRight", "center"]).default("left"),
  showSearch: z.boolean().default(true),
  showAccount: z.boolean().default(true),
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
    logoSize: { desktop: {}, tablet: {}, mobile: {} },
    showSearch: true,
    showAccount: true,
    showCart: true,
    sticky: true,
    tone: "default",
  },
  render: V.SiteHeaderView,
};

export const SOCIAL_NETWORKS = ["instagram", "facebook", "x", "youtube", "linkedin", "whatsapp", "email", "website"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SiteFooterSchema = z.object({
  about: z.string().max(300).optional(),
  /**
   * columns: brand and about text, then the link columns, then the newsletter. centered: everything centred, the
   * link columns in one row. compact: one slim row (brand and links), copyright below.
   */
  layout: z.enum(["columns", "centered", "compact"]).default("columns"),
  /** Shown in place of the store name when set; the logo image wins over the text. */
  logoText: z.string().max(60).optional(),
  logoMediaId: z.string().optional(),
  logoSize: logoSizeSchema,
  /** On phones each link column folds into an accordion (open one at a time by tapping its title). */
  mobileAccordion: z.boolean().default(true),
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
  /** Social icons under the brand: one per network, each linking out. Empty shows none. */
  socials: z
    .array(z.object({ network: z.enum(SOCIAL_NETWORKS), url: hrefSchema.min(1) }))
    .max(8)
    .default([]),
  socialStyle: z.enum(["plain", "filled", "outline"]).default("plain"),
  socialColor: z.enum(["text", "brand"]).default("text"),
  /** Icon size in pixels. */
  socialSize: z.number().int().min(14).max(40).default(20),
  showNewsletter: z.boolean().default(true),
  newsletterTitle: z.string().max(80).default("Newsletter"),
  newsletterText: z.string().max(200).default("Subscribe for updates and exclusive offers."),
  copyright: z.string().max(200).optional(),
  tone: toneSchema.default("surface"),
  /** Own colours; empty follows the background choice above. The text colour also drives the muted text, titles and lines. */
  bgColor: hexColorSchema.optional(),
  textColor: hexColorSchema.optional(),
});
export type SiteFooterProps = z.infer<typeof SiteFooterSchema>;
export const SiteFooterBlock: BlockDefinition<SiteFooterProps> = {
  type: "SiteFooter",
  version: 1,
  schema: SiteFooterSchema,
  defaultProps: {
    about: "Quality products, delivered with care.",
    layout: "columns",
    logoSize: { desktop: {}, tablet: {}, mobile: {} },
    mobileAccordion: true,
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
    socials: [],
    socialStyle: "plain",
    socialColor: "text",
    socialSize: 20,
    showNewsletter: true,
    newsletterTitle: "Newsletter",
    newsletterText: "Subscribe for updates and exclusive offers.",
    tone: "surface",
  },
  render: V.SiteFooterView,
};

const DEFAULT_PRODUCT_USPS = [
  { icon: "truck" as const, text: "Fast dispatch", description: "Packed and shipped within 24 hours" },
  { icon: "shield" as const, text: "Secure payment", description: "Encrypted checkout, details stay private" },
  { icon: "returns" as const, text: "Easy returns", description: "Simple returns if something is not right" },
];

export { PRODUCT_ELEMENTS, PRODUCT_ELEMENT_LABELS, normalizeElementOrder, type ProductElement } from "./product-elements.ts";

export const ProductDetailSchema = z.object({
  galleryPosition: z.enum(["left", "right"]).default("left"),
  showBreadcrumb: z.boolean().default(true),
  showRating: z.boolean().default(true),
  showDescription: z.boolean().default(true),
  showTags: z.boolean().default(true),
  /** Coupon cards under Add to cart (the discounts marked "Show on the storefront"), with a View all drawer. */
  showCoupons: z.boolean().default(true),
  couponCount: z.number().int().min(1).max(4).default(2),
  stickyBuyBox: z.boolean().default(false),
  showTrustPoints: z.boolean().default(false),
  trustPoints: z.array(z.string().min(1).max(60)).max(4).default(DEFAULT_TRUST_POINTS),
  stickyMobileBar: z.boolean().default(false),
  showSku: z.boolean().default(true),
  // Settings added later. Their schema defaults keep documents saved before them looking as they did (ADR-009); the new look is in defaultProps and the theme templates.
  /** Where the thumbnails sit next to the main picture (phones always put them below). */
  thumbPosition: z.enum(["bottom", "left", "right"]).default("bottom"),
  /** The short description stops after two lines with a "Read more" link that opens the full description in a popup. */
  showReadMore: z.boolean().default(false),
  variantStyle: z.enum(["buttons", "pills", "dropdown"]).default("buttons"),
  /** Small print under the price, e.g. "Tax and shipping calculated at checkout." Empty hides it. */
  priceNote: z.string().max(80).default(""),
  showBuyNow: z.boolean().default(false),
  addToCartLabel: z.string().min(1).max(30).default("Add to cart"),
  buyNowLabel: z.string().min(1).max(30).default("Buy it now"),
  addToCartBg: hexColorSchema.optional(),
  addToCartText: hexColorSchema.optional(),
  buyNowBg: hexColorSchema.optional(),
  buyNowText: hexColorSchema.optional(),
  showPaymentImage: z.boolean().default(false),
  /** A picture from the media library, e.g. a row of accepted payment methods. Empty uses the built-in "secure payment" badge. */
  paymentImageMediaId: z.string().uuid().optional(),
  paymentImageAlt: z.string().max(80).default("Secure payment"),
  showDeliveryEstimate: z.boolean().default(false),
  /** Orders placed before this hour (0-23, store time) ship the same day. */
  cutoffHour: z.number().int().min(0).max(23).default(14),
  /** Days from dispatch to delivery. */
  deliveryDays: z.number().int().min(1).max(21).default(3),
  shipsText: z.string().max(60).default("Ships within 24 hrs"),
  timeZone: z.string().max(40).default("Asia/Kolkata"),
  showUsps: z.boolean().default(false),
  usps: z
    .array(z.object({ icon: iconNameSchema.default("check"), text: z.string().min(1).max(40), description: z.string().max(80).optional() }))
    .max(4)
    .default(DEFAULT_PRODUCT_USPS),
  /** Order of the buy-box elements (see PRODUCT_ELEMENTS). Empty = the default order, as before. */
  elementOrder: z.array(z.enum(PRODUCT_ELEMENTS)).max(12).default([]),
  /** A list of collapsible rows (details, ingredients, brewing guide...) in the buy-box column. */
  showAccordion: z.boolean().default(false),
  accordionFirstOpen: z.boolean().default(true),
  accordionItems: z
    .array(
      z.object({
        icon: iconNameSchema.default("info"),
        title: z.string().min(1).max(60),
        /** "custom_field" shows the product's own value of the custom field `fieldKey` (hidden when the product has none); "static" shows `text`. */
        source: z.enum(["static", "custom_field"]).default("static"),
        fieldKey: z.string().max(80).optional(),
        text: z.string().max(2000).optional(),
      }),
    )
    .max(8)
    .default([]),
});
export type ProductDetailProps = z.infer<typeof ProductDetailSchema>;
export const ProductDetailBlock: BlockDefinition<ProductDetailProps> = {
  type: "ProductDetail",
  version: 1,
  schema: ProductDetailSchema,
  defaultProps: {
    galleryPosition: "left",
    showBreadcrumb: true,
    showRating: true,
    showDescription: true,
    showTags: true,
    showCoupons: true,
    couponCount: 2,
    stickyBuyBox: false,
    showTrustPoints: false,
    trustPoints: DEFAULT_TRUST_POINTS,
    stickyMobileBar: false,
    showSku: true,
    thumbPosition: "left",
    showReadMore: true,
    variantStyle: "pills",
    priceNote: "Tax and shipping calculated at checkout.",
    showBuyNow: true,
    addToCartLabel: "Add to cart",
    buyNowLabel: "Buy it now",
    showPaymentImage: true,
    paymentImageAlt: "Secure payment",
    showDeliveryEstimate: true,
    cutoffHour: 14,
    deliveryDays: 3,
    shipsText: "Ships within 24 hrs",
    timeZone: "Asia/Kolkata",
    showUsps: true,
    usps: DEFAULT_PRODUCT_USPS,
    elementOrder: [],
    showAccordion: false,
    accordionFirstOpen: true,
    accordionItems: [],
  },
  render: V.ProductDetailView,
};

/**
 * One custom field of the product (ADR-034): the owner picks a field key and the storefront shows that product's value.
 * Product pages only. Draws nothing when the product has no value for the field.
 */
export const ProductCustomFieldSchema = z.object({
  fieldKey: z.string().max(40).default(""),
  showLabel: z.boolean().default(true),
  label: z.string().max(80).default(""),
});
export type ProductCustomFieldProps = z.infer<typeof ProductCustomFieldSchema>;
export const ProductCustomFieldBlock: BlockDefinition<ProductCustomFieldProps> = {
  type: "ProductCustomField",
  version: 1,
  schema: ProductCustomFieldSchema,
  defaultProps: { fieldKey: "", showLabel: true, label: "" },
  render: V.ProductCustomFieldView,
};

export const CollectionListingSchema = z.object({
  columns: z.enum(["2", "3", "4"]).default("4"),
  showFilters: z.boolean().default(true),
  showDescription: z.boolean().default(true),
  columnsMobile: z.enum(["1", "2"]).default("1"),
  imageRatio: z.enum(["square", "portrait"]).default("square"),
  // Defaults here describe how documents saved before these settings existed keep looking (ADR-009); the new look is in defaultProps below and in the theme templates.
  cardStyle: z.enum(["borderless", "bordered", "minimal"]).default("bordered"),
  showSaleBadge: z.boolean().default(true),
  showRatings: z.boolean().default(true),
  showBreadcrumb: z.boolean().default(true),
  filterMenuHandle: z.string().optional(),
  /** Cards per row on tablets (640 to 1023px); `columns` is desktop, `columnsMobile` is phones. */
  columnsTablet: z.enum(["1", "2"]).default("2"),
  defaultView: z.enum(["grid", "list"]).default("grid"),
  showViewToggle: z.boolean().default(false),
  /** Products shown first and added by each "Load more". */
  pageSize: z.enum(["12", "24", "36"]).default("24"),
  /** Lets shoppers hide the filter sidebar on desktop. */
  filtersCollapsible: z.boolean().default(false),
  showAddToCart: z.boolean().default(false),
  /** Opens a quick-buy popup for products with variants; off sends the shopper to the product page. */
  showQuickAdd: z.boolean().default(true),
  showViewProduct: z.boolean().default(true),
  showCategoryBadge: z.boolean().default(false),
  hoverSecondImage: z.boolean().default(false),
});
export type CollectionListingProps = z.infer<typeof CollectionListingSchema>;
export const CollectionListingBlock: BlockDefinition<CollectionListingProps> = {
  type: "CollectionListing",
  version: 1,
  schema: CollectionListingSchema,
  defaultProps: {
    columns: "4",
    showFilters: true,
    showDescription: true,
    columnsMobile: "1",
    columnsTablet: "2",
    imageRatio: "square",
    cardStyle: "borderless",
    showSaleBadge: true,
    showRatings: true,
    showBreadcrumb: false,
    defaultView: "grid",
    showViewToggle: true,
    pageSize: "12",
    filtersCollapsible: true,
    showAddToCart: true,
    showQuickAdd: true,
    showViewProduct: true,
    showCategoryBadge: true,
    hoverSecondImage: true,
  },
  render: V.CollectionListingView,
};

/**
 * Blog slider: the Recent posts widget with the store's slider navigation (arrows on larger screens, flat page lines
 * on phones), cards per row for each device, and on phones a slider, a grid or a plain list (with or without thumbnails).
 */
export const BlogShowcaseSchema = z.object({
  title: z.string().max(120).default("From the blog"),
  subtitle: z.string().max(240).optional(),
  headerAlign: alignSchema.default("left"),
  source: z.enum(["latest", "featured", "category"]).default("latest"),
  categorySlug: z.string().max(120).optional(),
  count: z.number().int().min(1).max(12).default(6),
  tone: toneSchema.default("default"),
  width: widthSchema.default("wide"),
  box: layoutSchema.default({ desktop: { paddingTop: "48px", paddingBottom: "48px" }, mobile: { paddingTop: "32px", paddingBottom: "32px" } }),
  // Layout
  layout: z.enum(["slider", "grid"]).default("slider"),
  perViewDesktop: z.number().int().min(1).max(4).default(3),
  perViewTablet: z.number().int().min(1).max(3).default(2),
  perViewMobile: z.number().int().min(1).max(2).default(1),
  mobileLayout: z.enum(["slider", "grid", "list"]).default("slider"),
  /** Phone list only: a small picture beside each post. */
  listThumbnail: z.boolean().default(true),
  gap: z.number().int().min(0).max(48).default(20),
  // Card
  showImage: z.boolean().default(true),
  showExcerpt: z.boolean().default(true),
  excerptLines: z.enum(["2", "3", "4"]).default("2"),
  showDate: z.boolean().default(true),
  showAuthor: z.boolean().default(false),
  showCategory: z.boolean().default(true),
  imageRatio: z.enum(["landscape", "square", "portrait"]).default("landscape"),
  showViewAll: z.boolean().default(true),
  viewAllLabel: z.string().max(60).default("View all posts"),
  hideWhenEmpty: z.boolean().default(true),
  // Slider controls (same look as the product showcase)
  arrows: z.boolean().default(true),
  dots: z.boolean().default(true),
  dotsDesktop: z.boolean().default(false),
  dotsColor: z.enum(["light", "dark", "brand"]).default("dark"),
  autoplay: z.boolean().default(false),
  interval: z.number().int().min(2).max(20).default(6),
  loop: z.boolean().default(true),
});
export type BlogShowcaseProps = z.infer<typeof BlogShowcaseSchema>;

export const BlogShowcaseBlock: BlockDefinition<BlogShowcaseProps> = {
  type: "BlogShowcase",
  version: 1,
  schema: BlogShowcaseSchema,
  defaultProps: BlogShowcaseSchema.parse({}),
  render: VB.BlogShowcaseView,
};

/**
 * Collection products: the collection page's product grid (sort and filters, cards, load more) as a widget of its own.
 * Unlike "Collection page" it has no built-in heading or description unless switched on, so a Heading, Image or Text
 * widget can sit above or around it. Same cards and options; plus a section box and recommended defaults.
 */
export const CollectionProductsSchema = CollectionListingSchema.omit({ showBreadcrumb: true }).extend({
  showTitle: z.boolean().default(true),
  showDescription: z.boolean().default(false),
  showLongDescription: z.boolean().default(false),
  tone: toneSchema.default("default"),
  width: widthSchema.default("wide"),
  box: layoutSchema.default({ desktop: { paddingTop: "24px", paddingBottom: "40px" }, mobile: { paddingTop: "16px", paddingBottom: "32px" } }),
});
export type CollectionProductsProps = z.infer<typeof CollectionProductsSchema>;
export const CollectionProductsBlock: BlockDefinition<CollectionProductsProps> = {
  type: "CollectionProducts",
  version: 1,
  schema: CollectionProductsSchema,
  defaultProps: CollectionProductsSchema.parse({
    columns: "4",
    columnsTablet: "2",
    columnsMobile: "2",
    showFilters: true,
    imageRatio: "square",
    cardStyle: "borderless",
    showSaleBadge: true,
    showRatings: true,
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
  render: V.CollectionProductsView,
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
  /** Rounded corners of the slides (the picture and, on phones, the text block under it), per device and corner. */
  slideRadius: slideRadiusSchema,
  /**
   * How wide the slider is on the page: "full" runs edge to edge, "contained" is limited to the content width (the Section's
   * max width when set, else 80rem). Both are always centred; side margins from the Section panel do not apply to them.
   */
  widthMode: z.enum(["full", "contained"]).default("full"),
  /** Tablet (under 1024px) and phone (under 768px) can differ from the desktop choice; "inherit" follows the larger screen. */
  widthModeTablet: z.enum(["inherit", "full", "contained"]).default("inherit"),
  widthModeMobile: z.enum(["inherit", "full", "contained"]).default("inherit"),
  /** Phones: the text and buttons sit on a block below the picture or video ("below"), or over it as on larger screens ("overlay"). */
  mobileLayout: z.enum(["below", "overlay"]).default("below"),
  /** Colours of that block on phones; empty uses the theme's soft background and text colour. */
  mobileTextBg: hexColorSchema.optional(),
  mobileTextColor: hexColorSchema.optional(),
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
  /** Dots show on phones; on larger screens the arrows do the job. Turn this on to show them there too. */
  dotsDesktop: z.boolean().default(false),
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
  /** "related" is for the product page: products from the same collections or categories as the product being viewed (newest elsewhere). */
  source: z.enum(["newest", "featured", "collection", "related"]).default("collection"),
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
  /** Dots show on phones; on larger screens the arrows do the job. Turn this on to show them there too. */
  dotsDesktop: z.boolean().default(false),
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

// Blog (ADR-033)
const blogImageRatio = z.enum(["landscape", "square", "portrait"]);

export const BlogListingSchema = z.object({
  title: z.string().max(120).default("Blog"),
  subtitle: z.string().max(240).optional(),
  showCategories: z.boolean().default(true),
  layout: z.enum(["grid", "list"]).default("grid"),
  columns: z.enum(["2", "3", "4"]).default("3"),
  columnsTablet: z.enum(["1", "2"]).default("2"),
  columnsMobile: z.enum(["1", "2"]).default("1"),
  featuredFirst: z.boolean().default(false),
  showImage: z.boolean().default(true),
  showExcerpt: z.boolean().default(true),
  showDate: z.boolean().default(true),
  showAuthor: z.boolean().default(false),
  showReadingTime: z.boolean().default(true),
  showCategoryLabel: z.boolean().default(true),
  imageRatio: blogImageRatio.default("landscape"),
  /** 0 = use the store's blog setting. */
  postsPerPage: z.number().int().min(0).max(48).default(0),
  emptyText: z.string().max(160).default("No posts yet. Please check back soon."),
  // Magazine style (the blog index): headline, subscribe form, latest posts, then a row per category.
  style: z.enum(["classic", "magazine"]).default("magazine"),
  /** The first (bold) and second (light) part of the big headline. Empty = the heading above. */
  headlineBold: z.string().max(80).default(""),
  headlineLight: z.string().max(120).default(""),
  showSubscribe: z.boolean().default(true),
  subscribeLabel: z.string().max(30).default("Subscribe"),
  subscribePlaceholder: z.string().max(60).default("Your email address"),
  /** Optional heading and line above the subscribe form (right side of the header on desktop). */
  subscribeTitle: z.string().max(80).default(""),
  subscribeText: z.string().max(200).default(""),
  /** Small posts listed beside the large latest post. */
  latestSideCount: z.number().int().min(0).max(8).default(5),
  showCategorySections: z.boolean().default(true),
  postsPerCategory: z.number().int().min(1).max(8).default(4),
});
export type BlogListingProps = z.infer<typeof BlogListingSchema>;

export const BlogListingBlock: BlockDefinition<BlogListingProps> = {
  type: "BlogListing",
  version: 1,
  schema: BlogListingSchema,
  defaultProps: BlogListingSchema.parse({}),
  render: VB.BlogListingView,
};

export const BlogPostContentSchema = z.object({
  showBreadcrumb: z.boolean().default(true),
  showCategory: z.boolean().default(true),
  showDate: z.boolean().default(true),
  showAuthor: z.boolean().default(true),
  showReadingTime: z.boolean().default(true),
  featuredImage: z.enum(["above", "wide", "hidden"]).default("above"),
  contentWidth: z.enum(["narrow", "normal"]).default("narrow"),
  showToc: z.boolean().default(true),
  showShare: z.boolean().default(true),
  showRelated: z.boolean().default(true),
  relatedCount: z.number().int().min(0).max(6).default(3),
  showPrevNext: z.boolean().default(true),
  // Magazine layout (default): table of contents beside the text, sidebar with about card, featured posts and categories.
  layout: z.enum(["classic", "magazine"]).default("magazine"),
  tocPosition: z.enum(["left", "right"]).default("left"),
  showSidebar: z.boolean().default(true),
  /** The old "Blog / All posts" card. Off by default; the sidebar now shows related posts, a subscribe box and categories. */
  showAboutCard: z.boolean().default(false),
  aboutTitle: z.string().max(80).default(""),
  aboutText: z.string().max(300).default(""),
  showFeatured: z.boolean().default(false),
  featuredCount: z.number().int().min(1).max(8).default(5),
  showCategoriesCloud: z.boolean().default(true),
  showSubscribe: z.boolean().default(true),
  subscribeTitle: z.string().max(80).default("Subscribe to our newsletter"),
  subscribeText: z.string().max(200).default("New posts and updates, straight to your inbox."),
  subscribePlaceholder: z.string().max(60).default("Your email address"),
  subscribeLabel: z.string().max(30).default("Subscribe"),
});
export type BlogPostContentProps = z.infer<typeof BlogPostContentSchema>;

export const BlogPostContentBlock: BlockDefinition<BlogPostContentProps> = {
  type: "BlogPostContent",
  version: 1,
  schema: BlogPostContentSchema,
  defaultProps: BlogPostContentSchema.parse({}),
  render: VB.BlogPostContentView,
};

/** The Recent Posts widget: drop it on the home page or any other page. */
export const BlogPostsSchema = z.object({
  title: z.string().max(120).default("From the blog"),
  subtitle: z.string().max(240).optional(),
  source: z.enum(["latest", "featured", "category"]).default("latest"),
  /** Only used when source is "category" (a parent category includes its subcategories). */
  categorySlug: z.string().max(120).optional(),
  count: z.number().int().min(1).max(12).default(3),
  layout: z.enum(["grid", "list", "slider"]).default("grid"),
  columns: z.enum(["2", "3", "4"]).default("3"),
  columnsTablet: z.enum(["1", "2"]).default("2"),
  columnsMobile: z.enum(["1", "2"]).default("1"),
  showImage: z.boolean().default(true),
  showExcerpt: z.boolean().default(true),
  excerptLines: z.enum(["2", "3", "4"]).default("2"),
  showDate: z.boolean().default(true),
  showAuthor: z.boolean().default(false),
  showCategory: z.boolean().default(true),
  imageRatio: blogImageRatio.default("landscape"),
  showViewAll: z.boolean().default(true),
  viewAllLabel: z.string().max(60).default("View all posts"),
  /** Draw nothing (no empty heading) when the store has no posts to show. */
  hideWhenEmpty: z.boolean().default(true),
  tone: toneSchema.default("default"),
});
export type BlogPostsProps = z.infer<typeof BlogPostsSchema>;

export const BlogPostsBlock: BlockDefinition<BlogPostsProps> = {
  type: "BlogPosts",
  version: 1,
  schema: BlogPostsSchema,
  defaultProps: BlogPostsSchema.parse({}),
  render: VB.BlogPostsView,
};

/**
 * The Floating reviews widget: the store's published product reviews drift upwards in a column beside a heading.
 * Reviews come from the same data as the product pages (`reviews` table), resolved on the server per block.
 */
export const ReviewsMarqueeSchema = z.object({
  /** Small line above the heading; empty hides it. */
  eyebrow: z.string().max(60).default(""),
  title: z.string().max(120).default("Loved by our customers"),
  description: z.string().max(400).default("Real words from people who bought and tried our products."),
  /** Up to two buttons under the description; a button shows only when its link is filled in. */
  button1Label: z.string().max(40).default("See more reviews"),
  button1Href: hrefSchema.or(z.literal("")).default(""),
  button2Label: z.string().max(40).default("Learn more"),
  button2Href: hrefSchema.or(z.literal("")).default(""),
  /** Optional picture under (or above) the heading block; it fills the height left in that column. */
  imageMediaId: z.string().optional(),
  imageAlt: z.string().max(120).default(""),
  imagePlace: z.enum(["below", "above"]).default("below"),
  /** Where the heading block sits next to the reviews. "split" puts the heading on top and the description and buttons at the bottom. */
  textPosition: z.enum(["top", "middle", "bottom", "split"]).default("middle"),
  /** Which side the heading sits on; the moving reviews take the other side. */
  textSide: z.enum(["right", "left"]).default("right"),
  source: z.enum(["latest", "top"]).default("top"),
  minRating: z.number().int().min(1).max(5).default(4),
  limit: z.number().int().min(3).max(24).default(12),
  columns: z.enum(["1", "2"]).default("2"),
  speed: z.enum(["slow", "medium", "fast"]).default("slow"),
  height: z.enum(["sm", "md", "lg"]).default("md"),
  showTitle: z.boolean().default(true),
  showProduct: z.boolean().default(true),
  showVerified: z.boolean().default(true),
  showDate: z.boolean().default(false),
  /** Draw nothing when the store has no reviews to show yet. */
  hideWhenEmpty: z.boolean().default(true),
  tone: toneSchema.default("default"),
});
export type ReviewsMarqueeProps = z.infer<typeof ReviewsMarqueeSchema>;

export const ReviewsMarqueeBlock: BlockDefinition<ReviewsMarqueeProps> = {
  type: "ReviewsMarquee",
  version: 1,
  schema: ReviewsMarqueeSchema,
  defaultProps: ReviewsMarqueeSchema.parse({}),
  render: VR.ReviewsMarqueeView,
};

/**
 * Image banner: an uploaded picture (cover or contained) with an eyebrow, heading, description and up to two buttons
 * laid over it. The text group can sit anywhere on the picture (left/middle/right x top/middle/bottom).
 */
export const ImageBannerSchema = z.object({
  backgroundMediaId: z.string().optional(),
  imageFit: z.enum(["cover", "contain"]).default("cover"),
  /** Which part of the picture stays in view when it is cropped (cover) or where it rests (contain). */
  imagePosition: z.enum(["center", "top", "bottom", "left", "right"]).default("center"),
  /** Colour behind the picture (visible with "contain" or while it loads). */
  tone: toneSchema.default("surface"),
  height: z.enum(["sm", "md", "lg", "xl"]).default("lg"),
  width: widthSchema.default("wide"),
  radius: z.enum(["none", "md", "lg", "xl"]).default("lg"),
  overlayOpacity: z.number().min(0).max(100).default(0),
  eyebrow: z.string().max(80).default("Our story"),
  title: z.string().max(160).default("A headline that tells your story"),
  description: z.string().max(500).default("A short description that sits over your picture. Upload an image, then place this text anywhere on it."),
  button1Label: z.string().max(40).default("Shop now"),
  button1Href: hrefSchema.or(z.literal("")).default(""),
  button2Label: z.string().max(40).default("Learn more"),
  button2Href: hrefSchema.or(z.literal("")).default(""),
  /** Where the text group sits on the picture. */
  contentAlign: z.enum(["left", "center", "right"]).default("left"),
  contentVertical: z.enum(["top", "middle", "bottom"]).default("top"),
  /** Text alignment inside the group. */
  textAlign: z.enum(["left", "center", "right"]).default("left"),
  contentWidth: z.enum(["sm", "md", "lg", "full"]).default("md"),
  italic: z.boolean().default(true),
  eyebrowColor: hexColorSchema.optional(),
  titleColor: hexColorSchema.optional(),
  textColor: hexColorSchema.optional(),
});
export type ImageBannerProps = z.infer<typeof ImageBannerSchema>;

export const ImageBannerBlock: BlockDefinition<ImageBannerProps> = {
  type: "ImageBanner",
  version: 1,
  schema: ImageBannerSchema,
  defaultProps: ImageBannerSchema.parse({}),
  render: VI.ImageBannerView,
};

/**
 * FAQ accordion: the FAQ block plus a heading and description, a split layout (heading beside the questions) or a
 * stacked one, a card or plain look, and the open/close icon in front of or after each question.
 */
export const FaqSectionSchema = z.object({
  eyebrow: z.string().max(80).default(""),
  title: z.string().max(160).default("Frequently asked questions"),
  description: z.string().max(500).default("Everything you need to know before you order."),
  layout: z.enum(["split", "stacked"]).default("split"),
  /** Split layout: which side the heading sits on; the questions take the other side. */
  textSide: z.enum(["right", "left"]).default("right"),
  /** Split layout: where the heading block sits next to the questions. */
  textPosition: z.enum(["top", "middle", "bottom"]).default("top"),
  /** Stacked layout: heading and description alignment. */
  headingAlign: z.enum(["left", "center", "right"]).default("left"),
  style: z.enum(["cards", "plain"]).default("cards"),
  iconPosition: z.enum(["left", "right"]).default("right"),
  iconStyle: z.enum(["chevron", "plus"]).default("plus"),
  /** Open/close icon size in pixels. */
  iconSize: z.number().int().min(10).max(48).default(20),
  /** Space above and below each question in pixels (the row height). */
  rowPadding: z.number().int().min(4).max(48).default(16),
  /** Opening one question closes the others. */
  singleOpen: z.boolean().default(false),
  openFirst: z.boolean().default(false),
  width: widthSchema.default("wide"),
  tone: toneSchema.default("default"),
  items: z
    .array(z.object({ question: z.string().min(1), answer: z.string().min(1) }))
    .min(1)
    .default([
      { question: "How long does shipping take?", answer: "Standard shipping takes 3-5 business days across India." },
      { question: "What is your return policy?", answer: "We offer hassle-free returns within 7 days of delivery for unused items." },
      { question: "Can I pay on delivery?", answer: "Yes, cash on delivery is available on most orders." },
    ]),
});
export type FaqSectionProps = z.infer<typeof FaqSectionSchema>;

export const FaqSectionBlock: BlockDefinition<FaqSectionProps> = {
  type: "FaqSection",
  version: 1,
  schema: FaqSectionSchema,
  defaultProps: FaqSectionSchema.parse({}),
  render: VF.FaqSectionView,
};

/**
 * Collection showcase: the Collection grid with the heading placed left, middle or right, an optional button link,
 * up to six cards per desktop row (more collections wrap into more rows), and a grid or carousel choice for
 * tablets and phones. Collections are picked from the store's own list; the data is resolved like the Collection grid.
 */
/**
 * Multi card: a section of cards, each with an icon or picture, heading, text and link. Desktop is a grid of 1 to 4
 * cards; tablets and phones are a grid or a swipeable slider. Colours, borders, radius and spacing are set once for
 * every card; a card can have its own background picture.
 */
export const MultiCardItemSchema = z.object({
  /** A picture from the media library; wins over `icon`. */
  iconMediaId: z.string().optional(),
  icon: iconNameSchema.optional(),
  heading: z.string().max(120).default(""),
  text: z.string().max(1000).default(""),
  linkLabel: z.string().max(60).default(""),
  linkHref: hrefSchema.default(""),
  /** A background picture for this card only (overrides the section-wide one). */
  bgMediaId: z.string().optional(),
  /** Style 2 only: the picture across the top of the card. */
  imageMediaId: z.string().optional(),
});
export const MultiCardSchema = z.object({
  // Section
  tone: toneSchema.default("default"),
  sectionBg: hexColorSchema.optional(),
  width: widthSchema.default("wide"),
  box: layoutSchema.default({ desktop: { paddingTop: "48px", paddingBottom: "48px" }, mobile: { paddingTop: "32px", paddingBottom: "32px" } }),
  title: z.string().max(120).default(""),
  subtitle: z.string().max(300).default(""),
  headerAlign: alignSchema.default("left"),
  /** icon: Style 1 (icon, heading, text, link). image: Style 2 (picture on top, then heading, text, link). */
  cardStyle: z.enum(["icon", "image"]).default("icon"),
  imageRatio: z.enum(["16:9", "4:3", "1:1"]).default("4:3"),
  // Layout
  perRowDesktop: z.enum(["1", "2", "3", "4"]).default("3"),
  perRowTablet: z.enum(["1", "2", "3"]).default("2"),
  perRowMobile: z.enum(["1", "2"]).default("1"),
  tabletLayout: z.enum(["grid", "slider"]).default("grid"),
  mobileLayout: z.enum(["grid", "slider"]).default("slider"),
  /** Space between cards, px. */
  gap: z.number().int().min(0).max(64).default(16),
  // Slider
  arrows: z.boolean().default(true),
  dots: z.boolean().default(true),
  dotsColor: z.enum(["light", "dark", "brand"]).default("dark"),
  autoplay: z.boolean().default(false),
  interval: z.number().int().min(2).max(20).default(5),
  loop: z.boolean().default(true),
  // Card
  /** card: the bordered or filled box. plain: no box at all (no border, background or corners), just the content. */
  cardLook: z.enum(["card", "plain"]).default("card"),
  /** Where the icon sits against the text: above it, or beside it on the left or right. */
  iconPosition: z.enum(["top", "left", "right"]).default("top"),
  /** Beside the text (left or right): the icon lines up with the top of the text, or its middle. */
  iconAlign: z.enum(["start", "center"]).default("start"),
  cardPadding: z.number().int().min(0).max(64).default(24),
  cardRadius: z.number().int().min(0).max(48).default(12),
  borderWidth: z.number().int().min(0).max(8).default(1),
  borderColor: hexColorSchema.optional(),
  cardBg: hexColorSchema.optional(),
  cardText: hexColorSchema.optional(),
  cardBgMediaId: z.string().optional(),
  /** Darkening over a background picture, %. */
  cardOverlay: z.number().int().min(0).max(80).default(40),
  cardMinHeight: z.number().int().min(0).max(600).default(0),
  contentAlign: z.enum(["start", "center", "end"]).default("start"),
  textAlign: alignSchema.default("left"),
  /** Space between the icon, heading, text and link, px. */
  elementGap: z.number().int().min(0).max(48).default(12),
  // Elements
  showIcon: z.boolean().default(true),
  showHeading: z.boolean().default(true),
  showText: z.boolean().default(true),
  showLink: z.boolean().default(true),
  /** Unset: the theme's icon size (48 when the theme sets none). A size here wins over the theme. */
  iconSize: z.number().int().min(16).max(120).optional(),
  linkStyle: z.enum(["link", "button"]).default("link"),
  items: z
    .array(MultiCardItemSchema)
    .min(1)
    .max(12)
    .default([
      { icon: "truck", heading: "Fast delivery", text: "Packed with care and shipped within a day.", linkLabel: "", linkHref: "" },
      { icon: "shield", heading: "Secure checkout", text: "Pay by UPI, card or cash on delivery.", linkLabel: "", linkHref: "" },
      { icon: "returns", heading: "Easy returns", text: "A simple return if something is not right.", linkLabel: "", linkHref: "" },
    ]),
});
export type MultiCardProps = z.infer<typeof MultiCardSchema>;

export const MultiCardBlock: BlockDefinition<MultiCardProps> = {
  type: "MultiCard",
  version: 1,
  schema: MultiCardSchema,
  defaultProps: MultiCardSchema.parse({}),
  render: VM.MultiCardView,
};

/**
 * Coupon cards for the product page: the first few coupons the store chose to show (Discount > "Show on the storefront"), each with a
 * copy button, and a "View all" button that opens a side drawer with every one. Product pages only; draws nothing when no coupon is shown.
 */
export const ProductCouponsSchema = z.object({
  title: z.string().max(80).default("Available offers"),
  showCount: z.number().int().min(1).max(4).default(2),
  showViewAll: z.boolean().default(true),
  viewAllLabel: z.string().max(40).default("View all"),
});
export type ProductCouponsProps = z.infer<typeof ProductCouponsSchema>;
export const ProductCouponsBlock: BlockDefinition<ProductCouponsProps> = {
  type: "ProductCoupons",
  version: 1,
  schema: ProductCouponsSchema,
  defaultProps: ProductCouponsSchema.parse({}),
  render: VM.ProductCouponsView,
};

/**
 * Simple contact form: name and email always, and optionally a phone number, a dropdown list and a message. Submissions land in
 * the store admin inbox (Form submissions); `recipientEmail` records where they are meant to be sent (empty = the store's admin email).
 * It can be switched off without removing the block.
 */
export const ContactFormSchema = z.object({
  enabled: z.boolean().default(true),
  tone: toneSchema.default("default"),
  width: widthSchema.default("narrow"),
  box: layoutSchema.default({ desktop: { paddingTop: "48px", paddingBottom: "48px" }, mobile: { paddingTop: "32px", paddingBottom: "32px" } }),
  title: z.string().max(120).default("Get in touch"),
  description: z.string().max(300).default("Send us a message and we will get back to you."),
  /** Shown in the admin inbox so several forms can be told apart. */
  formName: z.string().max(80).default("Contact form"),
  /** Where the text in the fields and their labels sits. */
  fieldAlign: z.enum(["left", "center", "right"]).default("left"),
  recipientEmail: z.string().max(254).email().or(z.literal("")).default(""),
  showPhone: z.boolean().default(true),
  phoneRequired: z.boolean().default(false),
  showDropdown: z.boolean().default(false),
  dropdownLabel: z.string().max(60).default("Topic"),
  /** The dropdown choices, separated by commas. */
  dropdownOptions: z.string().max(600).default("General question, Order support, Wholesale"),
  showMessage: z.boolean().default(true),
  messageLabel: z.string().max(60).default("Message"),
  messageRequired: z.boolean().default(true),
  submitLabel: z.string().max(40).default("Send message"),
  successMessage: z.string().max(200).default("Thank you! We have received your message."),
  consentText: z.string().max(200).default(""),
});
export type ContactFormProps = z.infer<typeof ContactFormSchema>;
export const ContactFormBlock: BlockDefinition<ContactFormProps> = {
  type: "ContactForm",
  version: 1,
  schema: ContactFormSchema,
  defaultProps: ContactFormSchema.parse({}),
  render: VM.ContactFormView,
};

/**
 * Trust strip: icon, heading and short text per item, with every look setting chosen separately for desktop, tablet and
 * phone. Tablet and phone settings that are left empty follow the larger screen (desktop, then tablet).
 */
const TrustDeviceSchema = z.object({
  perRow: z.number().int().min(1).max(6).optional(),
  /** grid: all items in rows. slider: one row that swipes sideways, `perRow` visible at once. */
  layout: z.enum(["grid", "slider"]).optional(),
  /** card: a box (fill and border) around each item. plain: just the content. */
  look: z.enum(["card", "plain"]).optional(),
  iconPosition: z.enum(["top", "left"]).optional(),
  /** Text alignment when the icon sits above the text. */
  align: z.enum(["left", "center"]).optional(),
  sectionBg: hexColorSchema.optional(),
  cardBg: hexColorSchema.optional(),
  /** Space above and below the strip, px. */
  sectionPad: z.number().int().min(0).max(160).optional(),
  cardPad: z.number().int().min(0).max(48).optional(),
  gap: z.number().int().min(0).max(48).optional(),
  radius: z.number().int().min(0).max(32).optional(),
  iconSize: z.number().int().min(14).max(72).optional(),
  headingSize: z.number().int().min(10).max(32).optional(),
  textSize: z.number().int().min(9).max(24).optional(),
});
export type TrustDeviceStyle = z.infer<typeof TrustDeviceSchema>;
export const TRUST_DESKTOP_DEFAULTS = { perRow: 4, layout: "grid", look: "card", iconPosition: "top", align: "left", sectionPad: 32, cardPad: 20, gap: 16, radius: 12, iconSize: 28, headingSize: 15, textSize: 13 } as const;
export const TRUST_MOBILE_DEFAULTS = { perRow: 2, cardPad: 12, gap: 10, sectionPad: 20, iconSize: 22, headingSize: 13, textSize: 12 } as const;

export const TrustStripSchema = z.object({
  items: z
    .array(z.object({ icon: iconNameSchema.default("check"), title: z.string().max(80).default(""), description: z.string().max(200).default("") }))
    .min(1)
    .max(12)
    .default([
      { icon: "truck", title: "Free shipping", description: "On orders above ₹999" },
      { icon: "shield", title: "Secure checkout", description: "UPI, cards and cash on delivery" },
      { icon: "returns", title: "Easy returns", description: "7-day return guarantee" },
      { icon: "headphones", title: "Friendly support", description: "Phone and WhatsApp" },
    ]),
  width: widthSchema.default("wide"),
  styles: z
    .object({
      desktop: TrustDeviceSchema.default(TRUST_DESKTOP_DEFAULTS),
      tablet: TrustDeviceSchema.default({}),
      mobile: TrustDeviceSchema.default(TRUST_MOBILE_DEFAULTS),
    })
    .default({ desktop: TRUST_DESKTOP_DEFAULTS, tablet: {}, mobile: TRUST_MOBILE_DEFAULTS }),
});
export type TrustStripProps = z.infer<typeof TrustStripSchema>;

export const TrustStripBlock: BlockDefinition<TrustStripProps> = {
  type: "TrustStrip",
  version: 1,
  schema: TrustStripSchema,
  defaultProps: TrustStripSchema.parse({}),
  render: VT.TrustStripView,
};

export const CollectionShowcaseSchema = z.object({
  title: z.string().max(120).default("Shop by collection"),
  subtitle: z.string().max(300).default("Find exactly what you are looking for"),
  headerAlign: z.enum(["left", "center", "right"]).default("left"),
  /** The button shows only when its link is filled in. */
  buttonLabel: z.string().max(40).default("View all"),
  buttonHref: hrefSchema.or(z.literal("")).default("/collections"),
  /** What the cards list: the store's collections or its categories. */
  source: z.enum(["collections", "categories"]).default("collections"),
  collectionSlugs: z.array(z.string().max(200)).max(24).default([]),
  categorySlugs: z.array(z.string().max(200)).max(24).default([]),
  /** List every published collection (or active category), ignoring the chosen ones. */
  showAll: z.boolean().default(false),
  /** Cards per row on desktop (1024px and up); more collections wrap onto further rows. */
  columns: z.enum(["2", "3", "4", "5", "6"]).default("4"),
  /** Tablets (640 to 1023px): cards per row, or visible at once in the carousel. */
  columnsTablet: z.enum(["2", "3"]).default("2"),
  tabletLayout: z.enum(["grid", "carousel"]).default("grid"),
  /** Phones (under 640px). */
  columnsMobile: z.enum(["1", "2"]).default("1"),
  mobileLayout: z.enum(["grid", "carousel"]).default("carousel"),
  tone: toneSchema.default("default"),
});
export type CollectionShowcaseProps = z.infer<typeof CollectionShowcaseSchema>;

export const CollectionShowcaseBlock: BlockDefinition<CollectionShowcaseProps> = {
  type: "CollectionShowcase",
  version: 1,
  schema: CollectionShowcaseSchema,
  defaultProps: CollectionShowcaseSchema.parse({}),
  render: VC.CollectionShowcaseView,
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
  TrustStrip: TrustStripBlock,
  Section: SectionBlock,
  Container: ContainerBlock,
  Block: BlockBlock,
  Grid: GridBlock,
  FlexRow: FlexRowBlock,
  FlexColumn: FlexColumnBlock,
  Spacer: SpacerBlock,
  Divider: DividerBlock,
  Heading: HeadingBlock,
  Text: TextBlock,
  Image: ImageBlock,
  Video: VideoBlock,
  FileDownload: FileDownloadBlock,
  Button: ButtonBlock,
  Icon: IconBlock,
  Link: LinkBlock,
  CallToAction: CallToActionBlock,
  SiteHeader: SiteHeaderBlock,
  SiteFooter: SiteFooterBlock,
  ProductDetail: ProductDetailBlock,
  ProductCustomField: ProductCustomFieldBlock,
  ProductCoupons: ProductCouponsBlock,
  ContactForm: ContactFormBlock,
  CollectionListing: CollectionListingBlock,
  CartContents: CartContentsBlock,
  HeroSlider: HeroSliderBlock,
  ProductShowcase: ProductShowcaseBlock,
  BlogListing: BlogListingBlock,
  BlogPostContent: BlogPostContentBlock,
  BlogPosts: BlogPostsBlock,
  ReviewsMarquee: ReviewsMarqueeBlock,
  ImageBanner: ImageBannerBlock,
  FaqSection: FaqSectionBlock,
  CollectionShowcase: CollectionShowcaseBlock,
  MultiCard: MultiCardBlock,
  CollectionProducts: CollectionProductsBlock,
  BlogShowcase: BlogShowcaseBlock,
};

export const BLOCK_TYPES = Object.keys(BLOCK_DEFINITIONS) as BlockType[];

export function getBlockDefinition(type: "Hero"): BlockDefinition<HeroProps>;
export function getBlockDefinition(type: "Banner"): BlockDefinition<BannerProps>;
export function getBlockDefinition(type: "ProductGrid"): BlockDefinition<ProductGridProps>;
export function getBlockDefinition(type: "CollectionGrid"): BlockDefinition<CollectionGridProps>;
export function getBlockDefinition(type: "ProductCarousel"): BlockDefinition<ProductCarouselProps>;
export function getBlockDefinition(type: "Testimonials"): BlockDefinition<TestimonialsProps>;
export function getBlockDefinition(type: "Reviews"): BlockDefinition<ReviewsProps>;
export function getBlockDefinition(type: "FileDownload"): BlockDefinition<FileDownloadProps>;
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
