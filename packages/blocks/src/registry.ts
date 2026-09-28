import { z } from "zod";
import type { BlockDefinition, BlockType } from "./types.ts";
import React from "react";
import { sanitizeRichText } from "./sanitize.ts";

// 1. Hero Block
export const HeroSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  ctaText: z.string().optional(),
  ctaLink: z.string().optional(),
  secondaryCtaText: z.string().optional(),
  secondaryCtaLink: z.string().optional(),
  backgroundMediaId: z.string().optional(),
  alignment: z.enum(["left", "center", "right"]).default("center"),
  overlayOpacity: z.number().min(0).max(100).default(30),
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
  },
  render: ({ props }) => {
    return React.createElement(
      "section",
      { className: `bs-block-hero py-20 px-4 text-${props.alignment} bg-surface` },
      React.createElement("div", { className: "max-w-4xl mx-auto space-y-4" },
        React.createElement("h1", { className: "text-4xl md:text-6xl font-bold tracking-tight text-foreground" }, props.title),
        props.subtitle && React.createElement("p", { className: "text-lg md:text-xl text-muted" }, props.subtitle),
        props.ctaText && React.createElement(
          "div",
          { className: "pt-4 flex gap-4 justify-center" },
          React.createElement("a", { href: props.ctaLink || "#", className: "px-6 py-3 rounded-md bg-primary text-primary-foreground font-medium" }, props.ctaText),
          props.secondaryCtaText && React.createElement("a", { href: props.secondaryCtaLink || "#", className: "px-6 py-3 rounded-md border border-border text-foreground font-medium" }, props.secondaryCtaText),
        ),
      ),
    );
  },
};

// 2. Banner Block
export const BannerSchema = z.object({
  text: z.string().min(1),
  link: z.string().optional(),
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
  render: ({ props }) => {
    return React.createElement(
      "div",
      { className: "bs-block-banner py-2.5 px-4 text-center text-sm font-medium bg-primary text-primary-foreground" },
      props.link
        ? React.createElement("a", { href: props.link, className: "underline" }, props.text)
        : props.text,
    );
  },
};

// 3. ProductGrid Block
export const ProductGridSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  collectionSlug: z.string().optional(),
  limit: z.number().int().min(1).max(48).default(8),
  columns: z.enum(["2", "3", "4"]).default("4"),
  showPrice: z.boolean().default(true),
  showRating: z.boolean().default(true),
});
export type ProductGridProps = z.infer<typeof ProductGridSchema>;

export const ProductGridBlock: BlockDefinition<ProductGridProps> = {
  type: "ProductGrid",
  version: 1,
  schema: ProductGridSchema,
  defaultProps: {
    title: "Featured Products",
    subtitle: "Explore our latest arrivals",
    limit: 8,
    columns: "4",
    showPrice: true,
    showRating: true,
  },
  render: ({ props }) => {
    return React.createElement(
      "section",
      { className: "bs-block-product-grid py-12 px-4 max-w-7xl mx-auto" },
      React.createElement("div", { className: "text-center mb-8" },
        React.createElement("h2", { className: "text-3xl font-bold tracking-tight text-foreground" }, props.title),
        props.subtitle && React.createElement("p", { className: "text-muted mt-2" }, props.subtitle),
      ),
      React.createElement(
        "div",
        { className: `grid grid-cols-2 md:grid-cols-${props.columns} gap-6` },
        React.createElement("div", { className: "text-sm text-muted col-span-full text-center py-8" }, "Products display placeholder"),
      ),
    );
  },
};

// 4. CollectionGrid Block
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
  render: ({ props }) => {
    return React.createElement(
      "section",
      { className: "bs-block-collection-grid py-12 px-4 max-w-7xl mx-auto" },
      React.createElement("h2", { className: "text-2xl font-bold mb-6 text-foreground text-center" }, props.title),
      React.createElement("div", { className: `grid grid-cols-1 md:grid-cols-${props.columns} gap-6` }),
    );
  },
};

// 5. ProductCarousel Block
export const ProductCarouselSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  collectionSlug: z.string().optional(),
  limit: z.number().int().min(1).max(24).default(8),
  autoPlay: z.boolean().default(false),
});
export type ProductCarouselProps = z.infer<typeof ProductCarouselSchema>;

export const ProductCarouselBlock: BlockDefinition<ProductCarouselProps> = {
  type: "ProductCarousel",
  version: 1,
  schema: ProductCarouselSchema,
  defaultProps: {
    title: "Trending Items",
    subtitle: "Best sellers this week",
    limit: 8,
    autoPlay: false,
  },
  render: ({ props }) => {
    return React.createElement(
      "section",
      { className: "bs-block-product-carousel py-12 px-4 max-w-7xl mx-auto overflow-hidden" },
      React.createElement("h2", { className: "text-2xl font-bold mb-4 text-foreground" }, props.title),
    );
  },
};

// 6. Testimonials Block
export const TestimonialsSchema = z.object({
  title: z.string().default("What Our Customers Say"),
  items: z.array(
    z.object({
      quote: z.string().min(1),
      author: z.string().min(1),
      role: z.string().optional(),
      avatarMediaId: z.string().optional(),
    }),
  ).min(1),
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
      },
    ],
  },
  render: ({ props }) => {
    return React.createElement(
      "section",
      { className: "bs-block-testimonials py-16 px-4 bg-surface max-w-7xl mx-auto rounded-xl" },
      React.createElement("h2", { className: "text-3xl font-bold text-center mb-10 text-foreground" }, props.title),
      React.createElement(
        "div",
        { className: "grid grid-cols-1 md:grid-cols-3 gap-8" },
        props.items.map((item, idx) =>
          React.createElement(
            "blockquote",
            { key: idx, className: "p-6 rounded-lg border border-border bg-background" },
            React.createElement("p", { className: "text-muted italic mb-4" }, `"${item.quote}"`),
            React.createElement("div", { className: "font-semibold text-foreground text-sm" }, item.author),
            item.role && React.createElement("div", { className: "text-xs text-muted" }, item.role),
          ),
        ),
      ),
    );
  },
};

// 7. Reviews Block
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
  defaultProps: {
    title: "Customer Reviews",
    showAggregate: true,
    limit: 6,
  },
  render: ({ props }) => {
    return React.createElement(
      "section",
      { className: "bs-block-reviews py-12 px-4 max-w-4xl mx-auto" },
      React.createElement("h2", { className: "text-2xl font-bold mb-6 text-foreground" }, props.title),
    );
  },
};

// 8. RichText Block (Sanitized HTML only per ADR-009)
export const RichTextSchema = z.object({
  content: z.string().min(1),
  alignment: z.enum(["left", "center", "right"]).default("left"),
});
export type RichTextProps = z.infer<typeof RichTextSchema>;

export const RichTextBlock: BlockDefinition<RichTextProps> = {
  type: "RichText",
  version: 1,
  schema: RichTextSchema,
  defaultProps: {
    content: "<h2>About Our Craft</h2><p>We pride ourselves on attention to detail, sustainably sourced materials, and enduring design.</p>",
    alignment: "left",
  },
  render: ({ props }) => {
    const safeContent = sanitizeRichText(props.content);
    return React.createElement(
      "section",
      {
        className: `bs-block-richtext prose dark:prose-invert py-12 px-4 max-w-4xl mx-auto text-${props.alignment}`,
        dangerouslySetInnerHTML: { __html: safeContent },
      },
    );
  },
};

// 9. FAQ Block
export const FAQSchema = z.object({
  title: z.string().default("Frequently Asked Questions"),
  items: z.array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1),
    }),
  ).min(1),
});
export type FAQProps = z.infer<typeof FAQSchema>;

export const FAQBlock: BlockDefinition<FAQProps> = {
  type: "FAQ",
  version: 1,
  schema: FAQSchema,
  defaultProps: {
    title: "Frequently Asked Questions",
    items: [
      {
        question: "How long does shipping take?",
        answer: "Standard shipping takes 3-5 business days across India.",
      },
      {
        question: "What is your return policy?",
        answer: "We offer hassle-free returns within 7 days of delivery for unused items.",
      },
    ],
  },
  render: ({ props }) => {
    return React.createElement(
      "section",
      { className: "bs-block-faq py-12 px-4 max-w-3xl mx-auto space-y-6" },
      React.createElement("h2", { className: "text-3xl font-bold text-center mb-8 text-foreground" }, props.title),
      props.items.map((item, idx) =>
        React.createElement(
          "details",
          { key: idx, className: "group border border-border rounded-lg p-4 bg-surface cursor-pointer" },
          React.createElement("summary", { className: "font-semibold text-foreground" }, item.question),
          React.createElement("p", { className: "mt-2 text-muted text-sm" }, item.answer),
        ),
      ),
    );
  },
};

// 10. Gallery Block
export const GallerySchema = z.object({
  title: z.string().optional(),
  images: z.array(
    z.object({
      mediaId: z.string().min(1),
      caption: z.string().optional(),
      link: z.string().optional(),
    }),
  ).default([]),
  layout: z.enum(["grid", "masonry"]).default("grid"),
});
export type GalleryProps = z.infer<typeof GallerySchema>;

export const GalleryBlock: BlockDefinition<GalleryProps> = {
  type: "Gallery",
  version: 1,
  schema: GallerySchema,
  defaultProps: {
    title: "Lookbook",
    images: [],
    layout: "grid",
  },
  render: ({ props }) => {
    return React.createElement(
      "section",
      { className: "bs-block-gallery py-12 px-4 max-w-7xl mx-auto" },
      props.title && React.createElement("h2", { className: "text-2xl font-bold mb-6 text-foreground text-center" }, props.title),
    );
  },
};

// 11. Newsletter Block
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
  render: ({ props }) => {
    return React.createElement(
      "section",
      { className: "bs-block-newsletter py-16 px-4 bg-surface text-center max-w-4xl mx-auto rounded-xl my-8 border border-border" },
      React.createElement("h2", { className: "text-3xl font-bold mb-2 text-foreground" }, props.title),
      props.subtitle && React.createElement("p", { className: "text-muted mb-6 max-w-xl mx-auto" }, props.subtitle),
      React.createElement(
        "form",
        { className: "flex max-w-md mx-auto gap-2", onSubmit: (e) => e.preventDefault() },
        React.createElement("input", { type: "email", placeholder: props.placeholder, className: "flex-1 px-4 py-2 rounded-md border border-border bg-background text-foreground" }),
        React.createElement("button", { type: "submit", className: "px-6 py-2 rounded-md bg-primary text-primary-foreground font-medium" }, props.buttonText),
      ),
    );
  },
};

// 12. UspStrip Block
export const UspStripSchema = z.object({
  items: z.array(
    z.object({
      icon: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
    }),
  ).min(1),
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
  render: ({ props }) => {
    return React.createElement(
      "section",
      { className: "bs-block-usp-strip py-8 px-4 border-y border-border bg-surface" },
      React.createElement(
        "div",
        { className: "max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6" },
        props.items.map((item, idx) =>
          React.createElement(
            "div",
            { key: idx, className: "flex flex-col items-center text-center p-3" },
            React.createElement("div", { className: "font-semibold text-foreground text-sm" }, item.title),
            React.createElement("div", { className: "text-xs text-muted mt-1" }, item.description),
          ),
        ),
      ),
    );
  },
};

export { type BlockType } from "./types.ts";

export type AnyBlockDefinition =
  | BlockDefinition<HeroProps>
  | BlockDefinition<BannerProps>
  | BlockDefinition<ProductGridProps>
  | BlockDefinition<CollectionGridProps>
  | BlockDefinition<ProductCarouselProps>
  | BlockDefinition<TestimonialsProps>
  | BlockDefinition<ReviewsProps>
  | BlockDefinition<RichTextProps>
  | BlockDefinition<FAQProps>
  | BlockDefinition<GalleryProps>
  | BlockDefinition<NewsletterProps>
  | BlockDefinition<UspStripProps>;

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
};

export const BLOCK_TYPES = Object.keys(BLOCK_DEFINITIONS) as BlockType[];

export function getBlockDefinition<T extends BlockType>(type: T): AnyBlockDefinition {
  const def = BLOCK_DEFINITIONS[type];
  if (!def) {
    throw new Error(`Unknown block type: "${type}"`);
  }
  return def;
}
