import { z } from "zod";
import type { BlockDefinition, BlockType } from "./types.ts";
import {
  alignSchema,
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
  level: z.enum(["h1", "h2", "h3", "h4"]).default("h2"),
  size: z.enum(["sm", "md", "lg", "xl"]).default("lg"),
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
  size: z.enum(["sm", "md", "lg"]).default("md"),
  fullWidth: z.boolean().default(false),
  align: alignSchema.default("left"),
});
export type ButtonProps = z.infer<typeof ButtonSchema>;
export const ButtonBlock: BlockDefinition<ButtonProps> = {
  type: "Button",
  version: 1,
  schema: ButtonSchema,
  defaultProps: { label: "Shop now", href: "/collections/all", variant: "primary", size: "md", fullWidth: false, align: "left" },
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
