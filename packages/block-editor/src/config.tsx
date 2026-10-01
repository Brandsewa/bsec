import type { ComponentType, CSSProperties, ReactNode } from "react";
import type { Config, CustomField, Field } from "@puckeditor/core";
import { SLOT_BLOCK_TYPES, SLOT_PROP, getBlockDefinition, type BlockType, type RenderContext } from "@bs/blocks";
import { mediaField } from "./MediaField.tsx";
import { useRenderData } from "./context.tsx";

/**
 * Builds the Puck config from the versioned block registry (ADR-009). Field panels only expose
 * options the block schemas accept, so the editor can never produce a document that fails
 * validation for enum/link/size reasons.
 */

const pairs = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({ label, value }));
const yesNo = [
  { label: "Yes", value: true },
  { label: "No", value: false },
];
const text = (label: string): Field => ({ type: "text", label });
const area = (label: string): Field => ({ type: "textarea", label });
const num = (label: string, min: number, max: number): Field => ({ type: "number", label, min, max });
const select = (label: string, o: Record<string, string>): Field => ({ type: "select", label, options: pairs(o) });
const radio = (label: string): Field => ({ type: "radio", label, options: yesNo });
const link = (label: string): Field => text(`${label} (/path, https://…)`);

// string[] edited as one slug per line (the schema stores plain strings).
const listField = (label: string): CustomField<string[]> => ({
  type: "custom",
  label,
  render: ({ value, onChange, name }) => (
    <div>
      <label htmlFor={name} style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
        {label}
      </label>
      <textarea
        id={name}
        rows={4}
        defaultValue={(value ?? []).join("\n")}
        onChange={(e) => onChange(e.target.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 24))}
        style={{ width: "100%", border: "1px solid #ddd", borderRadius: 6, padding: 8, fontSize: 13 }}
      />
      <span style={{ fontSize: 11, color: "#666" }}>One slug per line</span>
    </div>
  ),
});

const TONE = { default: "Plain", surface: "Soft background", primary: "Brand colour" };
const ALIGN = { left: "Left", center: "Center", right: "Right" };
const SPACING = { none: "None", sm: "Small", md: "Medium", lg: "Large", xl: "Extra large" };
const GAP = { none: "None", sm: "Small", md: "Medium", lg: "Large" };
const WIDTH = { narrow: "Narrow", default: "Standard", wide: "Wide", full: "Full width" };
const ITEMS = { start: "Start", center: "Center", end: "End", stretch: "Stretch" };
const SOURCE = { newest: "Newest products", featured: "Featured products", collection: "From a collection", manual: "Pick by product slug" };
const ICONS = Object.fromEntries(["check", "star", "heart", "truck", "shield", "leaf", "gift", "phone", "mail", "award", "returns", "support"].map((n) => [n, n]));

type Spec = { label: string; fields: Record<string, Field>; category: "layout" | "content" | "store" };

const productFields = (carousel: boolean): Record<string, Field> => ({
  title: text("Heading"),
  subtitle: text("Subheading"),
  source: select("Products", SOURCE),
  collectionSlug: text("Collection slug (for “From a collection”)"),
  productSlugs: listField("Product slugs (for “Pick by slug”)") as Field,
  limit: num("How many", 1, carousel ? 24 : 48),
  columns: select("Columns", carousel ? { "2": "2", "3": "3", "4": "4", "5": "5" } : { "2": "2", "3": "3", "4": "4" }),
  showPrice: radio("Show price"),
  showRating: radio("Show rating"),
  ...(carousel ? { viewAllLabel: text("“View all” label"), viewAllHref: link("“View all” link") } : {}),
  tone: select("Background", TONE),
});

export const BLOCK_SPECS: Record<BlockType, Spec> = {
  Section: { label: "Section", category: "layout", fields: { [SLOT_PROP]: { type: "slot" }, tone: select("Background", TONE), paddingY: select("Vertical space", SPACING), width: select("Content width", WIDTH), backgroundMediaId: mediaField("Background image") as Field, overlayOpacity: num("Image darkening %", 0, 100) } },
  Container: { label: "Container", category: "layout", fields: { [SLOT_PROP]: { type: "slot" }, width: select("Width", WIDTH), tone: select("Background", TONE), paddingY: select("Vertical space", SPACING), align: select("Text align", ALIGN) } },
  Grid: { label: "Grid", category: "layout", fields: { [SLOT_PROP]: { type: "slot" }, columns: num("Columns (desktop)", 1, 6), columnsMobile: num("Columns (mobile)", 1, 2), gap: select("Gap", GAP) } },
  FlexRow: { label: "Flex row", category: "layout", fields: { [SLOT_PROP]: { type: "slot" }, gap: select("Gap", GAP), alignItems: select("Vertical align", ITEMS), justify: select("Horizontal align", { start: "Start", center: "Center", end: "End", between: "Space between" }) } },
  FlexColumn: { label: "Flex column", category: "layout", fields: { [SLOT_PROP]: { type: "slot" }, gap: select("Gap", GAP), alignItems: select("Align", ITEMS) } },
  Spacer: { label: "Spacer", category: "layout", fields: { size: select("Height", { sm: "Small", md: "Medium", lg: "Large", xl: "Extra large" }) } },
  Divider: { label: "Divider", category: "layout", fields: { width: select("Width", WIDTH) } },

  Heading: { label: "Heading", category: "content", fields: { text: text("Text"), level: select("Tag", { h1: "H1", h2: "H2", h3: "H3", h4: "H4" }), size: select("Size", { sm: "Small", md: "Medium", lg: "Large", xl: "Extra large" }), align: select("Align", ALIGN) } },
  Text: { label: "Text", category: "content", fields: { text: area("Text (blank line = new paragraph)"), align: select("Align", ALIGN), muted: radio("Softer colour") } },
  RichText: { label: "Rich text", category: "content", fields: { content: area("HTML (formatting tags only)"), alignment: select("Align", ALIGN) } },
  Image: { label: "Image", category: "content", fields: { mediaId: mediaField("Image") as Field, alt: text("Alt text"), ratio: select("Shape", { auto: "Original", square: "Square", "4-3": "4:3", "16-9": "16:9" }), rounded: radio("Rounded corners"), href: link("Link") } },
  Video: { label: "Video", category: "content", fields: { url: text("YouTube, Vimeo or .mp4 link") } },
  Button: { label: "Button", category: "content", fields: { label: text("Label"), href: link("Link"), variant: select("Style", { primary: "Solid", secondary: "Soft", outline: "Outline" }), size: select("Size", { sm: "Small", md: "Medium", lg: "Large" }), fullWidth: radio("Full width"), align: select("Align", ALIGN) } },
  Icon: { label: "Icon", category: "content", fields: { name: select("Icon", ICONS), size: select("Size", { sm: "Small", md: "Medium", lg: "Large" }), align: select("Align", ALIGN) } },
  Link: { label: "Link", category: "content", fields: { label: text("Label"), href: link("Link"), newTab: radio("Open in new tab") } },

  Hero: { label: "Hero banner", category: "store", fields: { eyebrow: text("Small heading"), title: text("Heading"), subtitle: area("Subheading"), ctaText: text("Main button"), ctaLink: link("Main button link"), secondaryCtaText: text("Second button"), secondaryCtaLink: link("Second button link"), backgroundMediaId: mediaField("Background image") as Field, overlayOpacity: num("Image darkening %", 0, 100), alignment: select("Align", ALIGN), tone: select("Colour (no image)", TONE) } },
  Banner: { label: "Announcement bar", category: "store", fields: { text: text("Message"), link: link("Link"), variant: select("Style", { promo: "Promo", info: "Info", warning: "Warning" }) } },
  ProductCarousel: { label: "Product carousel", category: "store", fields: productFields(true) },
  ProductGrid: { label: "Product grid", category: "store", fields: productFields(false) },
  CollectionGrid: { label: "Collection grid", category: "store", fields: { title: text("Heading"), subtitle: text("Subheading"), collectionSlugs: listField("Collection slugs") as Field, columns: select("Columns", { "2": "2", "3": "3", "4": "4" }) } },
  Testimonials: { label: "Testimonials", category: "store", fields: { title: text("Heading"), layout: select("Layout", { grid: "Grid", carousel: "Carousel", single: "Single" }), tone: select("Background", TONE), items: { type: "array", label: "Testimonials", getItemSummary: (i: { author?: string }) => i.author ?? "Testimonial", arrayFields: { author: text("Customer name"), role: text("Role (e.g. Verified buyer)"), quote: area("Testimonial"), rating: num("Rating (1-5)", 1, 5), avatarMediaId: mediaField("Customer photo") as Field }, defaultItemProps: { author: "Customer", quote: "Great product!", rating: 5 } } as Field } },
  Reviews: { label: "Reviews", category: "store", fields: { title: text("Heading"), showAggregate: radio("Show average"), limit: num("How many", 1, 20) } },
  CallToAction: { label: "Call to action", category: "store", fields: { heading: text("Heading"), text: area("Supporting text"), primaryLabel: text("Main button"), primaryHref: link("Main button link"), secondaryLabel: text("Second button (optional)"), secondaryHref: link("Second button link"), backgroundMediaId: mediaField("Background image") as Field, overlayOpacity: num("Image darkening %", 0, 100), tone: select("Colour (no image)", TONE), align: select("Align", { center: "Center", left: "Left", right: "Right" }) } },
  FAQ: { label: "FAQ", category: "store", fields: { title: text("Heading"), items: { type: "array", label: "Questions", getItemSummary: (i: { question?: string }) => i.question ?? "Question", arrayFields: { question: text("Question"), answer: area("Answer") }, defaultItemProps: { question: "Question", answer: "Answer" } } as Field } },
  Gallery: { label: "Gallery", category: "store", fields: { title: text("Heading"), images: { type: "array", label: "Images", getItemSummary: (i: { caption?: string }) => i.caption ?? "Image", arrayFields: { mediaId: mediaField("Image") as Field, caption: text("Caption"), link: link("Link") } } as Field } },
  Newsletter: { label: "Newsletter", category: "store", fields: { title: text("Heading"), subtitle: text("Subheading"), buttonText: text("Button"), placeholder: text("Email placeholder") } },
  UspStrip: { label: "Trust strip", category: "store", fields: { items: { type: "array", label: "Points", getItemSummary: (i: { title?: string }) => i.title ?? "Point", arrayFields: { icon: select("Icon", ICONS), title: text("Title"), description: text("Description") }, defaultItemProps: { icon: "check", title: "Title", description: "Description" } } as Field } },
};

const CATEGORY_TITLES = { layout: "Layout", content: "Content", store: "Store widgets" } as const;

type AnyProps = Record<string, unknown> & { id: string; puck?: unknown };

function EditorBlock({ type, props }: { type: BlockType; props: AnyProps }): ReactNode {
  const def = getBlockDefinition(type);
  const { data, media } = useRenderData();
  const { id, puck: _puck, ...rest } = props;
  void _puck;

  // `content` is a slot only on layout blocks (RichText has a plain `content` string prop).
  const isLayout = SLOT_BLOCK_TYPES.has(type);
  const slot = isLayout
    ? (rest[SLOT_PROP] as ComponentType<{ className?: string; style?: CSSProperties; minEmptyHeight?: number }> | undefined)
    : undefined;
  const { [SLOT_PROP]: slotValue, ...withoutSlot } = rest;
  void slotValue;
  const blockProps: Record<string, unknown> = isLayout ? withoutSlot : rest;

  // Mid-edit values can be temporarily invalid (empty required text): fall back to defaults like the storefront does.
  const parsed = def.schema.safeParse(blockProps);
  const effective = parsed.success ? parsed.data : { ...def.defaultProps, ...blockProps };

  const ctx: RenderContext = { blockId: id, data, mediaUrl: (mid) => media[mid] ?? null };
  const children = slot
    ? ({ className, style }: { className?: string; style?: CSSProperties }) => {
        const Slot = slot;
        return <Slot {...(className ? { className } : {})} {...(style ? { style } : {})} minEmptyHeight={64} />;
      }
    : undefined;

  return def.render({ props: effective, children, ctx });
}

export function buildPuckConfig(options: { themeVars: Record<string, string> }): Config {
  const components: Record<string, unknown> = {};
  const byCategory: Record<string, string[]> = { layout: [], content: [], store: [] };

  for (const [type, spec] of Object.entries(BLOCK_SPECS) as Array<[BlockType, Spec]>) {
    const def = getBlockDefinition(type);
    byCategory[spec.category]?.push(type);
    components[type] = {
      label: spec.label,
      fields: spec.fields,
      defaultProps: SLOT_BLOCK_TYPES.has(type) ? { ...def.defaultProps, [SLOT_PROP]: [] } : def.defaultProps,
      render: (props: AnyProps) => <EditorBlock type={type} props={props} />,
    };
  }

  return {
    categories: Object.fromEntries(
      (Object.keys(CATEGORY_TITLES) as Array<keyof typeof CATEGORY_TITLES>).map((k) => [
        k,
        { title: CATEGORY_TITLES[k], components: byCategory[k] ?? [], defaultExpanded: k !== "layout" },
      ]),
    ),
    components,
    root: {
      // Page-level settings (SEO etc.) live on the page record, not in the block document.
      fields: {},
      // The canvas shows the store's own theme: same --bs-* variables the storefront sets.
      render: ({ children }: { children: ReactNode }) => (
        <div className="bsb" style={{ ...(options.themeVars as CSSProperties), background: "var(--bs-bg, #fff)", minHeight: "100vh" }}>
          {children}
        </div>
      ),
    },
  } as unknown as Config;
}
