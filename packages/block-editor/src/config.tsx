import type { ComponentType, CSSProperties, ReactNode } from "react";
import type { Config, CustomField, Field } from "@puckeditor/core";
import { SLOT_BLOCK_TYPES, SLOT_PROP, getBlockDefinition, renderBlockTree, type BlockType, type RenderContext } from "@bs/blocks";
import { mediaField, videoMediaField, fileMediaField } from "./MediaField.tsx";
import { menuField } from "./MenuField.tsx";
import { collectionsField } from "./CollectionsField.tsx";
import { logoSizeField } from "./HeaderFooterPanels.tsx";
import { elementOrderField } from "./ElementOrderField.tsx";
import { accordionFields } from "./sections.tsx";
import { layoutField, slideRadiusField } from "./LayoutField.tsx";
import { useFrame, useRenderData } from "./context.tsx";

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

// A compact on/off switch row (label left, switch right) for settings that are plain Yes/No. Stores the same boolean as radio().
const toggle = (label: string): CustomField<boolean | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value === true}
        aria-label={label}
        onClick={() => onChange(!(value === true))}
        style={{ flex: "none", position: "relative", width: 30, height: 18, borderRadius: 999, border: 0, padding: 0, cursor: "pointer", background: value === true ? "#18181b" : "#d4d4d8", transition: "background .15s" }}
      >
        <span style={{ position: "absolute", top: 2, left: value === true ? 14 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
      </button>
    </div>
  ),
});

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

// string[] edited as one short line each (unlike listField, spaces and commas stay inside a line).
const linesField = (label: string, max: number): CustomField<string[]> => ({
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
        onChange={(e) => onChange(e.target.value.split("\n").map((x) => x.trim().slice(0, 60)).filter(Boolean).slice(0, max))}
        style={{ width: "100%", border: "1px solid #ddd", borderRadius: 6, padding: 8, fontSize: 13 }}
      />
    </div>
  ),
});

// A #rrggbb colour (round swatch + hex) that can be cleared to fall back to the theme's colour.
const colorField = (label: string): CustomField<string | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange, name }) => (
    <div>
      <span style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ position: "relative", width: 26, height: 26, flex: "none", borderRadius: "50%", background: value ?? "repeating-conic-gradient(#e4e4e7 0 25%, #fff 0 50%) 50% / 10px 10px", border: "1px solid rgba(0,0,0,.18)", boxShadow: "inset 0 0 0 2px #fff", overflow: "hidden", cursor: "pointer" }}>
          <input type="color" id={name} aria-label={label} value={value ?? "#000000"} onChange={(e) => onChange(e.target.value)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: 0, padding: 0 }} />
        </label>
        <span style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: value ? "#18181b" : "#71717a" }}>{value ?? "Theme colour"}</span>
        {value ? (
          <button type="button" onClick={() => onChange(undefined)} style={{ border: 0, background: "none", color: "#2563eb", fontSize: 11, cursor: "pointer", padding: 0 }}>
            Use theme colour
          </button>
        ) : null}
      </div>
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
const ICONS = Object.fromEntries(["check", "star", "heart", "truck", "shield", "leaf", "gift", "phone", "mail", "award", "returns", "support", "clipboard", "cup", "help", "info", "package", "droplet"].map((n) => [n, n]));

type Spec = { label: string; fields: Record<string, Field>; category: "layout" | "content" | "store" | "bcom" };

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

  Heading: { label: "Heading", category: "content", fields: { text: text("Text"), level: select("Tag", { h1: "H1", h2: "H2", h3: "H3", h4: "H4", h5: "H5", h6: "H6" }), size: select("Size", { auto: "Match the heading level (theme sizes)", sm: "Small", md: "Medium", lg: "Large", xl: "Extra large" }), align: select("Align", ALIGN) } },
  Text: { label: "Text", category: "content", fields: { text: area("Text (blank line = new paragraph)"), align: select("Align", ALIGN), muted: radio("Softer colour") } },
  RichText: { label: "Rich text", category: "content", fields: { content: area("HTML (formatting tags only)"), alignment: select("Align", ALIGN) } },
  Image: { label: "Image", category: "content", fields: { mediaId: mediaField("Image") as Field, alt: text("Alt text"), ratio: select("Shape", { auto: "Original", square: "Square", "4-3": "4:3", "16-9": "16:9" }), rounded: radio("Rounded corners"), href: link("Link") } },
  Video: {
    label: "Video",
    category: "content",
    fields: {
      mediaId: videoMediaField("Library video") as Field,
      posterMediaId: mediaField("Poster image") as Field,
      autoplayLoop: radio("Autoplay loop (muted)"),
      url: text("Or video URL (YouTube, Vimeo, MP4)"),
    },
  },
  FileDownload: {
    label: "File download",
    category: "content",
    fields: {
      label: text("Download button label"),
      description: area("Description (optional)"),
      mediaId: fileMediaField("Document file") as Field,
    },
  },
  Button: { label: "Button", category: "content", fields: { label: text("Label"), href: link("Link"), variant: select("Style", { primary: "Solid", secondary: "Soft", outline: "Outline" }), size: select("Size", { auto: "Match theme", sm: "Small", md: "Medium", lg: "Large" }), fullWidth: radio("Full width"), align: select("Align", ALIGN) } },
  Icon: { label: "Icon", category: "content", fields: { name: select("Icon", ICONS), size: select("Size", { sm: "Small", md: "Medium", lg: "Large" }), align: select("Align", ALIGN) } },
  Link: { label: "Link", category: "content", fields: { label: text("Label"), href: link("Link"), newTab: radio("Open in new tab") } },

  Hero: { label: "Hero banner", category: "store", fields: { eyebrow: text("Small heading"), title: text("Heading"), subtitle: area("Subheading"), ctaText: text("Main button"), ctaLink: link("Main button link"), secondaryCtaText: text("Second button"), secondaryCtaLink: link("Second button link"), backgroundMediaId: mediaField("Background image") as Field, overlayOpacity: num("Image darkening %", 0, 100), alignment: select("Align", ALIGN), tone: select("Colour (no image)", TONE) } },
  Banner: { label: "Announcement bar", category: "store", fields: { text: text("Message"), link: link("Link"), variant: select("Style", { promo: "Promo", info: "Info", warning: "Warning" }) } },
  ProductCarousel: { label: "Product carousel", category: "store", fields: productFields(true) },
  ProductGrid: { label: "Product grid", category: "store", fields: productFields(false) },
  CollectionGrid: { label: "Collection grid", category: "store", fields: { title: text("Heading"), subtitle: text("Description under the heading"), headerAlign: select("Heading and description position", ALIGN), showAll: radio("List every published collection"), collectionSlugs: listField("Collection slugs (ignored when listing every collection)") as Field, columns: select("Cards per row: desktop", { "4": "4", "3": "3", "2": "2" }), columnsTablet: select("Cards per row: tablet", { "2": "2", "1": "1" }), columnsMobile: select("Cards per row: mobile", { "1": "1", "2": "2" }) } },
  BlogPosts: { label: "Recent blog posts", category: "store", fields: { title: text("Heading"), subtitle: text("Description under the heading"), source: select("Which posts", { latest: "Newest posts", featured: "Featured posts", category: "From one category" }), categorySlug: text("Category address (only for 'From one category')"), count: num("How many posts", 1, 12), layout: select("Layout", { grid: "Grid", list: "List", slider: "Slider (swipe sideways)" }), columns: select("Posts per row: desktop", { "4": "4", "3": "3", "2": "2" }), columnsTablet: select("Posts per row: tablet", { "2": "2", "1": "1" }), columnsMobile: select("Posts per row: phone", { "1": "1", "2": "2" }), imageRatio: select("Image shape", { landscape: "Landscape", square: "Square", portrait: "Portrait (4:5)" }), showImage: radio("Image"), showExcerpt: radio("Summary"), excerptLines: select("Summary lines", { "2": "2", "3": "3", "4": "4" }), showDate: radio("Date"), showAuthor: radio("Author"), showCategory: radio("Category label"), showViewAll: radio("'View all' link"), viewAllLabel: text("'View all' link text"), hideWhenEmpty: radio("Hide the section when there are no posts"), tone: select("Background", TONE) } },
  BlogListing: { label: "Blog archive posts", category: "store", fields: { title: text("Heading"), subtitle: text("Description under the heading"), showCategories: radio("Category links"), layout: select("Layout", { grid: "Grid", list: "List" }), columns: select("Posts per row: desktop", { "4": "4", "3": "3", "2": "2" }), columnsTablet: select("Posts per row: tablet", { "2": "2", "1": "1" }), columnsMobile: select("Posts per row: phone", { "1": "1", "2": "2" }), featuredFirst: radio("Show the first post larger"), imageRatio: select("Image shape", { landscape: "Landscape", square: "Square", portrait: "Portrait (4:5)" }), showImage: radio("Image"), showExcerpt: radio("Summary"), showDate: radio("Date"), showAuthor: radio("Author"), showReadingTime: radio("Reading time"), showCategoryLabel: radio("Category label"), postsPerPage: num("Posts per page (0 = use the blog setting)", 0, 48), emptyText: text("Text when there are no posts") } },
  BlogPostContent: { label: "Blog post", category: "store", fields: { showBreadcrumb: radio("Breadcrumb"), showCategory: radio("Category label"), showDate: radio("Date"), showAuthor: radio("Author"), showReadingTime: radio("Reading time"), featuredImage: select("Featured image", { above: "Above the text", wide: "Wide, above the title", hidden: "Hidden" }), contentWidth: select("Text width", { narrow: "Narrow (easy to read)", normal: "Normal" }), showToc: radio("Table of contents (3 or more headings)"), showShare: radio("Share links"), showRelated: radio("Related posts"), relatedCount: num("How many related posts", 0, 6), showPrevNext: radio("Previous and next post links") } },
  Testimonials: { label: "Testimonials", category: "store", fields: { title: text("Heading"), layout: select("Layout", { grid: "Grid", carousel: "Carousel", single: "Single" }), tone: select("Background", TONE), items: { type: "array", label: "Testimonials", getItemSummary: (i: { author?: string }) => i.author ?? "Testimonial", arrayFields: { author: text("Customer name"), role: text("Role (e.g. Verified buyer)"), quote: area("Testimonial"), rating: num("Rating (1-5)", 1, 5), avatarMediaId: mediaField("Customer photo") as Field }, defaultItemProps: { author: "Customer", quote: "Great product!", rating: 5 } } as Field } },
  Reviews: { label: "Reviews", category: "store", fields: { title: text("Heading"), showAggregate: radio("Show average"), limit: num("How many", 1, 20) } },
  CallToAction: { label: "Call to action", category: "store", fields: { heading: text("Heading"), text: area("Supporting text"), primaryLabel: text("Main button"), primaryHref: link("Main button link"), secondaryLabel: text("Second button (optional)"), secondaryHref: link("Second button link"), backgroundMediaId: mediaField("Background image") as Field, overlayOpacity: num("Image darkening %", 0, 100), tone: select("Colour (no image)", TONE), align: select("Align", { center: "Center", left: "Left", right: "Right" }) } },
  FAQ: { label: "FAQ", category: "store", fields: { title: text("Heading"), items: { type: "array", label: "Questions", getItemSummary: (i: { question?: string }) => i.question ?? "Question", arrayFields: { question: text("Question"), answer: area("Answer") }, defaultItemProps: { question: "Question", answer: "Answer" } } as Field } },
  Gallery: { label: "Gallery", category: "store", fields: { title: text("Heading"), images: { type: "array", label: "Images", getItemSummary: (i: { caption?: string }) => i.caption ?? "Image", arrayFields: { mediaId: mediaField("Image") as Field, caption: text("Caption"), link: link("Link") } } as Field } },
  Newsletter: { label: "Newsletter", category: "store", fields: { title: text("Heading"), subtitle: text("Subheading"), buttonText: text("Button"), placeholder: text("Email placeholder") } },
  SiteHeader: { label: "Header", category: "store", fields: { menuHandle: menuField("Navigation menu") as Field, logoText: text("Logo text (empty = store logo / name)"), logoMediaId: mediaField("Custom logo image (overrides brand logo)") as Field, logoSize: logoSizeField("Logo size") as Field, layout: select("Layout", { left: "Logo left, menu next to it", navCenter: "Logo left, menu in the middle", logoCenter: "Menu left, logo in the middle", logoRight: "Logo right, menu left", center: "Stacked: logo in the middle, menu below" }), links: { type: "array", label: "Fallback menu links", getItemSummary: (i: { label?: string }) => i.label ?? "Link", arrayFields: { label: text("Label"), href: link("Link") }, defaultItemProps: { label: "Link", href: "/" } } as Field, showSearch: radio("Search icon"), showAccount: radio("Account icon"), showCart: radio("Cart icon"), sticky: radio("Stay at top while scrolling"), tone: select("Background", TONE) } },
  SiteFooter: { label: "Footer", category: "store", fields: { layout: select("Layout", { columns: "Columns: brand, link columns, newsletter", centered: "Centred: brand on top, link columns in a row", compact: "Compact: brand and links side by side" }), logoMediaId: mediaField("Logo image (empty = brand name)") as Field, logoSize: logoSizeField("Logo size") as Field, logoText: text("Brand name (empty = store name)"), about: area("About text"), mobileAccordion: radio("Fold link columns into an accordion on phones"), columns: { type: "array", label: "Link columns", getItemSummary: (i: { title?: string }) => i.title ?? "Column", arrayFields: { title: text("Column title"), menuHandle: menuField("Navigation menu") as Field, links: { type: "array", label: "Fallback links", getItemSummary: (i: { label?: string }) => i.label ?? "Link", arrayFields: { label: text("Label"), href: link("Link") }, defaultItemProps: { label: "Link", href: "/" } } as Field }, defaultItemProps: { title: "Column", links: [] } } as Field, showNewsletter: radio("Newsletter signup"), newsletterTitle: text("Newsletter heading"), newsletterText: text("Newsletter text"), copyright: text("Copyright line (empty = automatic)"), tone: select("Background", TONE) } },
  ProductDetail: {
    label: "Product details",
    category: "store",
    fields: accordionFields("ProductDetail", [
      { id: "order", title: "Order of the elements", fields: { elementOrder: elementOrderField("Drag to move, or use the arrows") as Field } },
      {
        id: "layout",
        title: "Layout",
        fields: {
          galleryPosition: select("Images side", { left: "Left", right: "Right" }),
          thumbPosition: select("Thumbnails", { bottom: "Below the picture", left: "Left of the picture", right: "Right of the picture" }),
          variantStyle: select("Options as", { pills: "Small pills", buttons: "Buttons", dropdown: "Dropdowns" }),
          stickyBuyBox: toggle("Keep buy box in view while scrolling") as Field,
        },
      },
      {
        id: "info",
        title: "Product info",
        fields: {
          showBreadcrumb: toggle("Breadcrumb") as Field,
          showRating: toggle("Review summary (hidden when there are no reviews)") as Field,
          showSku: toggle("SKU") as Field,
          showDescription: toggle("Short description") as Field,
          showReadMore: toggle("Two lines with a Read more popup") as Field,
          showTags: toggle("Tags") as Field,
          priceNote: text("Note under the price (empty hides it)"),
        },
      },
      {
        id: "buttons",
        title: "Add to cart and Buy now",
        fields: {
          addToCartLabel: text("Add to cart label"),
          addToCartBg: colorField("Add to cart colour") as Field,
          addToCartText: colorField("Add to cart text colour") as Field,
          showBuyNow: toggle("Buy it now button") as Field,
          buyNowLabel: text("Buy it now label"),
          buyNowBg: colorField("Buy it now colour") as Field,
          buyNowText: colorField("Buy it now text colour") as Field,
          stickyMobileBar: toggle("Phone: price and add-to-cart bar while scrolling") as Field,
        },
      },
      {
        id: "trust",
        title: "Payment and reassurance",
        fields: {
          showPaymentImage: toggle("Secure payment picture") as Field,
          paymentImageMediaId: mediaField("Secure payment picture (empty = built-in badge)") as Field,
          paymentImageAlt: text("Secure payment picture description"),
          showTrustPoints: toggle("Reassurance lines under the button") as Field,
          trustPoints: linesField("Reassurance lines (one per line, max 4)", 4) as Field,
        },
      },
      {
        id: "delivery",
        title: "Delivery estimate",
        fields: {
          showDeliveryEstimate: toggle("Delivery estimate") as Field,
          cutoffHour: num("Same-day dispatch before (hour, 0-23)", 0, 23),
          deliveryDays: num("Delivery takes (days)", 1, 21),
          shipsText: text("Dispatch note"),
          timeZone: text("Time zone (e.g. Asia/Kolkata)"),
        },
      },
      {
        id: "highlights",
        title: "Highlight cards",
        fields: {
          showUsps: toggle("Small highlight cards") as Field,
          usps: { type: "array", label: "Highlight cards (max 4)", getItemSummary: (i: { text?: string }) => i.text ?? "Card", arrayFields: { icon: select("Icon", ICONS), text: text("Title"), description: text("Short description (optional)") }, defaultItemProps: { icon: "check", text: "Highlight", description: "" } } as Field,
        },
      },
      {
        id: "accordion",
        title: "Accordion (details rows)",
        fields: {
          showAccordion: toggle("Accordion (details rows) in this column") as Field,
          accordionFirstOpen: toggle("Accordion: first row open") as Field,
          accordionItems: { type: "array", label: "Accordion rows (max 8)", max: 8, getItemSummary: (i: { title?: string }) => i.title ?? "Row", arrayFields: { icon: select("Icon", ICONS), title: text("Title"), source: select("Content", { static: "Text written here", custom_field: "A custom field of the product" }), fieldKey: text("Custom field key (Settings > Custom fields)"), text: area("Text (for \"Text written here\")") }, defaultItemProps: { icon: "info", title: "Details", source: "static", text: "" } } as Field,
        },
      },
    ]),
  },
  ProductCustomField: { label: "Custom field", category: "store", fields: { fieldKey: text("Field key (from Settings > Custom fields)"), showLabel: radio("Show the field name"), label: text("Name override (optional)") } },
  ProductInfoTabs: { label: "Product tabs and picture", category: "store", fields: { descriptionLabel: text("First tab name"), shippingLabel: text("Second tab name"), shippingContent: area("Second tab text (blank line = new paragraph, \"- \" = list item)"), imageMediaId: mediaField("Picture (empty = placeholder)") as Field, imageAlt: text("Picture description"), imageSide: select("Picture side", { right: "Right", left: "Left" }) } },
  HeroSlider: {
    label: "Hero slider",
    category: "bcom",
    fields: accordionFields("HeroSlider", [
      {
        id: "slides",
        title: "Slides",
        fields: {
          slides: {
            type: "array",
            label: "Slides (up to 6)",
            max: 6,
            getItemSummary: (i: { title?: string }, idx?: number) => i.title || `Slide ${(idx ?? 0) + 1}`,
            arrayFields: {
              backgroundMediaId: mediaField("Background image (also the video's poster)") as Field,
              videoUrl: text("Background video (direct .mp4 / .webm link, optional)"),
              title: text("Heading"),
              subtitle: area("Subheading"),
              primaryLabel: text("Main button label"),
              primaryHref: link("Main button link"),
              secondaryLabel: text("Second button label"),
              secondaryHref: link("Second button link"),
            },
            defaultItemProps: { title: "New slide", subtitle: "", primaryLabel: "Shop now", primaryHref: "/collections/all", secondaryLabel: "", secondaryHref: "" },
          } as Field,
          titleSize: select("Heading size (theme H2 / H1)", { lg: "Large (H2 size)", xl: "Extra large (H1 size)" }),
          titleTag: select("First slide heading tag (SEO)", { h2: "H2", h1: "H1 (use once per page)" }),
          slideRadius: slideRadiusField("Slide corners (border radius)") as Field,
        },
      },
      {
        id: "text",
        title: "Text and buttons",
        fields: {
          layout: select("Text and buttons", { split: "Text left, buttons right", stacked: "Text, then buttons below" }),
          align: select("Alignment (stacked)", ALIGN),
          contentPosition: select("Vertical position", { bottom: "Bottom", center: "Middle" }),
          height: select("Slide height", { sm: "Small", md: "Medium", lg: "Large", screen: "Almost full screen" }),
          contentWidth: select("Content width", { default: "Standard", wide: "Wide", full: "Full width" }),
          mobileLayout: select("On phones", { below: "Text and buttons below the picture", overlay: "Text and buttons over the picture" }),
          mobileTextBg: colorField("Phone: text block colour") as Field,
          mobileTextColor: colorField("Phone: text colour") as Field,
        },
      },
      {
        id: "section",
        title: "Section",
        fields: { widthMode: select("Width on the page", { full: "Full width (edge to edge)", contained: "Contained (content width, centred)" }), box: layoutField("Section", { radius: false }) as Field },
      },
      {
        id: "shade",
        title: "Background and shade",
        fields: {
          shade: radio("Shade from the bottom edge"),
          shadeStrength: num("Shade strength %", 0, 100),
          shadeHeight: select("Shade height", { sm: "Small", md: "Medium", lg: "Tall" }),
          dim: num("Darken whole image %", 0, 80),
        },
      },
      {
        id: "buttons",
        title: "Buttons",
        fields: {
          buttonSize: select("Size", { auto: "Match theme", sm: "Small", md: "Medium", lg: "Large" }),
          primaryStyle: select("Main button style", { dark: "Dark (theme main button)", light: "Light (theme secondary)", outline: "Outline" }),
          secondaryStyle: select("Second button style", { dark: "Dark (theme main button)", light: "Light (theme secondary)", outline: "Outline" }),
          primaryBg: colorField("Main button background") as Field,
          primaryText: colorField("Main button text") as Field,
          secondaryBg: colorField("Second button background") as Field,
          secondaryText: colorField("Second button text") as Field,
        },
      },
      {
        id: "behaviour",
        title: "Autoplay and loop",
        fields: {
          autoplay: radio("Autoplay"),
          interval: num("Seconds per slide", 2, 20),
          loop: radio("Loop back to the first slide"),
          pauseOnHover: radio("Pause while hovering"),
        },
      },
      {
        id: "dots",
        title: "Pagination dots",
        fields: {
          dots: radio("Show dots"),
          dotsStyle: select("Style", { dot: "Dots", pill: "Active pill", line: "Lines" }),
          dotsSize: select("Size", { sm: "Small", md: "Medium", lg: "Large" }),
          dotsColor: select("Colour", { light: "Light", dark: "Dark", brand: "Theme button colour" }),
          dotsPosition: select("Position", { left: "Left", center: "Centre", right: "Right" }),
        },
      },
      {
        id: "arrows",
        title: "Arrows",
        fields: {
          arrows: radio("Show arrows"),
          arrowStyle: select("Style", { circle: "Circle", square: "Rounded square", plain: "Plain" }),
          arrowSize: select("Size", { sm: "Small", md: "Medium", lg: "Large" }),
          arrowColor: select("Colour", { light: "Light", dark: "Dark", brand: "Theme button colour" }),
          arrowsOnMobile: radio("Also show on phones"),
        },
      },
    ]),
  },
  ImageBanner: {
    label: "Image banner",
    category: "bcom",
    fields: accordionFields("ImageBanner", [
      {
        id: "picture",
        title: "Picture",
        fields: {
          backgroundMediaId: mediaField("Image") as Field,
          imageFit: select("Fit", { cover: "Cover (fill and crop)", contain: "Contain (show it all)" }),
          imagePosition: select("Keep in view", { center: "Centre", top: "Top", bottom: "Bottom", left: "Left", right: "Right" }),
          tone: select("Colour behind the image", TONE),
          overlayOpacity: num("Image darkening %", 0, 100),
          height: select("Height", { sm: "Short", md: "Medium", lg: "Tall", xl: "Extra tall" }),
          width: select("Banner width", WIDTH),
          radius: select("Rounded corners", { none: "None", md: "Small", lg: "Large", xl: "Extra large" }),
        },
      },
      {
        id: "text",
        title: "Text",
        fields: {
          eyebrow: text("Small line above the heading"),
          title: text("Heading"),
          description: area("Description"),
          italic: radio("Italic small line and description"),
          eyebrowColor: colorField("Small line colour") as Field,
          titleColor: colorField("Heading colour") as Field,
          textColor: colorField("Description colour") as Field,
        },
      },
      {
        id: "buttons",
        title: "Buttons (shown only with a link)",
        fields: {
          button1Label: text("Button 1 text"),
          button1Href: link("Button 1 link"),
          button2Label: text("Button 2 text"),
          button2Href: link("Button 2 link"),
        },
      },
      {
        id: "place",
        title: "Text position",
        fields: {
          contentAlign: select("Across", { left: "Left", center: "Middle", right: "Right" }),
          contentVertical: select("Up and down", { top: "Top", middle: "Middle", bottom: "Bottom" }),
          textAlign: select("Text alignment", ALIGN),
          contentWidth: select("Text width", { sm: "Narrow", md: "Medium", lg: "Wide", full: "Full" }),
        },
      },
    ]),
  },
  FaqSection: {
    label: "FAQ accordion",
    category: "bcom",
    fields: accordionFields("FaqSection", [
      {
        id: "heading",
        title: "Heading and description",
        fields: {
          eyebrow: text("Small line above the heading (empty hides it)"),
          title: text("Heading"),
          description: area("Description under the heading"),
          tone: select("Background", TONE),
          width: select("Width", WIDTH),
        },
      },
      {
        id: "layout",
        title: "Layout",
        fields: {
          layout: select("Layout", { split: "Split (heading beside the questions)", stacked: "Stacked (heading above the questions)" }),
          textSide: select("Split: heading side", { right: "Right (questions on the left)", left: "Left (questions on the right)" }),
          textPosition: select("Split: heading position", { top: "Top", middle: "Middle", bottom: "Bottom" }),
          headingAlign: select("Stacked: heading alignment", ALIGN),
        },
      },
      {
        id: "look",
        title: "Questions look",
        fields: {
          style: select("Style", { cards: "Cards", plain: "Plain (soft lines)" }),
          iconPosition: select("Icon", { right: "After the question", left: "In front of the question" }),
          iconStyle: select("Icon shape", { plus: "Plus / minus", chevron: "Arrow" }),
          singleOpen: radio("Opening one closes the others"),
          openFirst: radio("First question open"),
        },
      },
      {
        id: "items",
        title: "Questions",
        fields: {
          items: { type: "array", label: "Questions", getItemSummary: (i: { question?: string }) => i.question ?? "Question", arrayFields: { question: text("Question"), answer: area("Answer") }, defaultItemProps: { question: "Question", answer: "Answer" } } as Field,
        },
      },
    ]),
  },
  CollectionShowcase: {
    label: "Collection showcase",
    category: "bcom",
    fields: accordionFields("CollectionShowcase", [
      {
        id: "heading",
        title: "Heading and button",
        fields: {
          title: text("Heading"),
          subtitle: text("Description under the heading"),
          headerAlign: select("Heading position", { left: "Left (button on the right)", center: "Middle (button below)", right: "Right (button on the left)" }),
          buttonLabel: text("Button text"),
          buttonHref: link("Button link (empty hides the button)"),
          tone: select("Background", TONE),
        },
      },
      {
        id: "collections",
        title: "Collections",
        fields: {
          showAll: radio("Show every published collection"),
          collectionSlugs: collectionsField("Pick collections (ignored when showing every collection)") as Field,
        },
      },
      {
        id: "layout",
        title: "Layout",
        fields: {
          columns: select("Cards per row: desktop (more wrap to extra rows)", { "2": "2", "3": "3", "4": "4", "5": "5", "6": "6" }),
          tabletLayout: select("Tablet", { grid: "Grid", carousel: "Carousel (swipe sideways)" }),
          columnsTablet: select("Tablet: cards per row or visible at once", { "2": "2", "3": "3" }),
          mobileLayout: select("Phone", { grid: "Grid", carousel: "Carousel (swipe sideways)" }),
          columnsMobile: select("Phone: cards per row or visible at once", { "1": "1", "2": "2" }),
        },
      },
    ]),
  },
  ReviewsMarquee: {
    label: "Floating reviews",
    category: "bcom",
    fields: accordionFields("ReviewsMarquee", [
      {
        id: "heading",
        title: "Heading and layout",
        fields: {
          eyebrow: text("Small line above the heading (empty hides it)"),
          title: text("Heading"),
          description: area("Description under the heading"),
          textSide: select("Heading side", { right: "Right (reviews on the left)", left: "Left (reviews on the right)" }),
          textPosition: select("Text position", { top: "Top", middle: "Middle", bottom: "Bottom", split: "Split (heading top, description and buttons bottom)" }),
          tone: select("Background", TONE),
        },
      },
      {
        id: "buttons",
        title: "Buttons (shown only with a link)",
        fields: {
          button1Label: text("Button 1 text"),
          button1Href: link("Button 1 link"),
          button2Label: text("Button 2 text"),
          button2Href: link("Button 2 link"),
        },
      },
      {
        id: "reviews",
        title: "Which reviews",
        fields: {
          source: select("Pick", { top: "Highest rated first", latest: "Newest first" }),
          minRating: num("Lowest star rating to show (1-5)", 1, 5),
          limit: num("How many reviews", 3, 24),
          hideWhenEmpty: radio("Hide the section until there are reviews"),
        },
      },
      {
        id: "motion",
        title: "Movement and size",
        fields: {
          columns: select("Columns of reviews", { "2": "Two", "1": "One" }),
          speed: select("Speed", { slow: "Slow", medium: "Medium", fast: "Fast" }),
          height: select("Height", { sm: "Short", md: "Medium", lg: "Tall" }),
        },
      },
      {
        id: "card",
        title: "Review card",
        fields: {
          showTitle: radio("Review title"),
          showProduct: radio("Product name"),
          showVerified: radio("Verified buyer tag"),
          showDate: radio("Date"),
        },
      },
    ]),
  },
  ProductShowcase: {
    label: "Product showcase",
    category: "bcom",
    fields: accordionFields("ProductShowcase", [
      {
        id: "heading",
        title: "Heading",
        fields: {
          title: text("Heading"),
          subtitle: text("Subheading"),
          headerAlign: select("Alignment", ALIGN),
          tone: select("Background", TONE),
        },
      },
      {
        id: "products",
        title: "Products and tabs",
        fields: {
          tabs: {
            type: "array",
            label: "Collections (two or more turn the tabs on)",
            max: 6,
            getItemSummary: (i: { label?: string; source?: string; collectionSlug?: string }, idx?: number) => i.label || i.collectionSlug || i.source || `Tab ${(idx ?? 0) + 1}`,
            arrayFields: {
              label: text("Tab name"),
              source: select("Products", { newest: "Newest products", featured: "Featured products", collection: "From a collection", related: "Related to the product (product page)" }),
              collectionSlug: text("Collection slug (for \u201cFrom a collection\u201d)"),
            },
            defaultItemProps: { label: "New tab", source: "collection", collectionSlug: "" },
          } as Field,
          limit: num("Products per tab", 2, 24),
          tabsStyle: select("Tab style", { text: "Underlined text", pill: "Pills" }),
        },
      },
      {
        id: "card",
        title: "Product card",
        fields: {
          cardOrder: {
            type: "array",
            label: "Rows under the image (drag to reorder)",
            max: 3,
            getItemSummary: (i: { item?: string; show?: boolean }) => `${{ rating: "Reviews", title: "Title", price: "Price" }[i.item ?? "title"] ?? "Row"}${i.show === false ? " (hidden)" : ""}`,
            arrayFields: {
              item: select("Row", { rating: "Reviews", title: "Title", price: "Price" }),
              show: radio("Show"),
            },
            defaultItemProps: { item: "title", show: true },
          } as Field,
          badge: select("Badge on the image", { none: "None", category: "Category", brand: "Brand" }),
          showSaleBadge: radio("Sale badge (Save %)"),
          showCompareAt: radio("Crossed-out compare price"),
          startsFrom: select("\u201cStarts from\u201d label", { auto: "When variants differ in price", always: "Always", never: "Never" }),
          showAddToCart: radio("Add-to-cart button on the image"),
          imageRatio: select("Image shape", { square: "Square", portrait: "Portrait (4:5)", landscape: "Landscape (4:3)" }),
          cardStyle: select("Card style", { soft: "Soft image tile", bordered: "Bordered card", minimal: "Minimal" }),
          titleSize: select("Title size", { sm: "Small", md: "Medium", lg: "Large" }),
          titleLines: select("Title lines", { "1": "One line", "2": "Up to two lines" }),
          priceSize: select("Price size", { sm: "Small", md: "Medium", lg: "Large" }),
        },
      },
      {
        id: "cards",
        title: "Cards per row",
        fields: {
          perViewDesktop: num("Cards per row (desktop)", 2, 6),
          perViewTablet: num("Cards per row (tablet)", 1, 4),
          perViewMobile: num("Cards per row (phone)", 1, 3),
          gap: select("Space between cards", { sm: "Small", md: "Medium", lg: "Large" }),
        },
      },
      {
        id: "section",
        title: "Section",
        fields: { box: layoutField("Section") as Field },
      },
      {
        id: "arrows",
        title: "Arrows",
        fields: {
          arrows: radio("Show arrows"),
          arrowStyle: select("Style", { circle: "Circle", square: "Rounded square", plain: "Plain" }),
          arrowSize: select("Size", { sm: "Small", md: "Medium", lg: "Large" }),
          arrowColor: select("Colour", { light: "Light", dark: "Dark", brand: "Theme button colour" }),
          arrowsOnMobile: radio("Also show on phones"),
        },
      },
      {
        id: "dots",
        title: "Pagination dots",
        fields: {
          dots: radio("Show dots"),
          dotsStyle: select("Style", { dot: "Dots", pill: "Active pill", line: "Lines" }),
          dotsSize: select("Size", { sm: "Small", md: "Medium", lg: "Large" }),
          dotsColor: select("Colour", { light: "Light", dark: "Dark", brand: "Theme button colour" }),
          dotsPosition: select("Position", { left: "Left", center: "Centre", right: "Right" }),
        },
      },
      {
        id: "autoplay",
        title: "Autoplay",
        fields: {
          autoplay: radio("Autoplay"),
          interval: num("Seconds per page", 2, 20),
          loop: radio("Loop back to the start"),
          pauseOnHover: radio("Pause while hovering"),
        },
      },
    ]),
  },
  CartContents: { label: "Cart contents", category: "store", fields: { heading: text("Page heading"), checkoutLabel: text("Checkout button label"), showFreeShippingBar: radio("Free-shipping progress bar (uses the store's shipping settings)"), showTrustPoints: radio("Reassurance lines under the button"), trustPoints: linesField("Reassurance lines (one per line, max 4)", 4) as Field, stickyMobileCheckout: radio("Phone: total and checkout bar while scrolling"), showContinueShopping: radio("Continue shopping link"), summaryPosition: select("Order summary", { right: "Right", left: "Left" }), stickySummary: radio("Keep summary in view while scrolling"), showDiscountCode: radio("Discount code box"), showShippingEstimator: radio("Shipping estimator") } },
  CollectionListing: { label: "Collection products", category: "store", fields: { filterMenuHandle: menuField("Filter menu") as Field, columns: select("Cards per row: desktop", { "4": "4", "3": "3", "2": "2" }), columnsTablet: select("Cards per row: tablet", { "2": "2", "1": "1" }), columnsMobile: select("Cards per row: phone", { "1": "1", "2": "2" }), pageSize: select("Products per load", { "12": "12", "24": "24", "36": "36" }), defaultView: select("Default view", { grid: "Grid", list: "List" }), showViewToggle: radio("Grid / list switch"), imageRatio: select("Image shape", { square: "Square", portrait: "Portrait (4:5)" }), cardStyle: select("Card style", { borderless: "Borderless", bordered: "Bordered", minimal: "Minimal" }), hoverSecondImage: radio("Second image on hover"), showSaleBadge: radio("Discount badge"), showCategoryBadge: radio("Category badge"), showRatings: radio("Ratings"), showAddToCart: radio("Add to cart icon on image"), showQuickAdd: radio("Quick-buy popup for products with variants"), showViewProduct: radio("View product link in popup"), showBreadcrumb: radio("Breadcrumb"), showFilters: radio("Sort and filters"), filtersCollapsible: radio("Filter sidebar can be hidden"), showDescription: radio("Collection description") } },
  UspStrip: { label: "Trust strip", category: "store", fields: { items: { type: "array", label: "Points", getItemSummary: (i: { title?: string }) => i.title ?? "Point", arrayFields: { icon: select("Icon", ICONS), title: text("Title"), description: text("Description") }, defaultItemProps: { icon: "check", title: "Title", description: "Description" } } as Field } },
};

const CATEGORY_TITLES = { layout: "Layout", content: "Content", store: "Store widgets", bcom: "BCOM widgets" } as const;

type AnyProps = Record<string, unknown> & { id: string; puck?: unknown };

/**
 * The theme's header or footer around the page being edited, so the page is seen in its real surroundings. It is
 * drawn from the same block data as the storefront (menus included) and cannot be clicked: it is edited from the
 * Header and Footer pages.
 */
function FrameBlocks({ part }: { part: "header" | "footer" }): ReactNode {
  const frame = useFrame();
  const { data, media, storeName } = useRenderData();
  const blocks = frame?.[part] ?? [];
  if (blocks.length === 0) return null;
  const ctx: RenderContext = { data, mediaUrl: (mid) => media[mid] ?? null, ...(storeName ? { storeName } : {}) };
  return (
    <div data-bs-frame={part} style={{ pointerEvents: "none", userSelect: "none" }} aria-hidden="true">
      {renderBlockTree(blocks, ctx)}
    </div>
  );
}

function EditorBlock({ type, props }: { type: BlockType; props: AnyProps }): ReactNode {
  const def = getBlockDefinition(type);
  const { data, media, storeName } = useRenderData();
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

  const ctx: RenderContext = { blockId: id, data, mediaUrl: (mid) => media[mid] ?? null, ...(storeName ? { storeName } : {}) };
  const children = slot
    ? ({ className, style }: { className?: string; style?: CSSProperties }) => {
        const Slot = slot;
        return <Slot {...(className ? { className } : {})} {...(style ? { style } : {})} minEmptyHeight={64} />;
      }
    : undefined;

  return def.render({ props: effective, children, ctx });
}

/** Which kind of theme page is being edited; limits the block picker to blocks that make sense there. */
export type EditorPageKind = "home" | "collections" | "collection" | "product" | "cart" | "blogArchive" | "blogPost" | "header" | "footer" | "custom";

const ONLY: Record<"header" | "footer", BlockType[]> = {
  header: ["SiteHeader", "Banner"],
  footer: ["SiteFooter", "Newsletter", "UspStrip", "Banner", "Heading", "Text", "Divider", "Spacer"],
};
const CHROME: BlockType[] = ["SiteHeader", "SiteFooter"];
/** Still drawn when a page already uses them (templates, saved pages), but no longer offered in the block picker. */
export const RETIRED_FROM_PICKER: BlockType[] = ["Testimonials"];

export function blockAllowed(type: BlockType, kind: EditorPageKind): boolean {
  if (kind === "header" || kind === "footer") return ONLY[kind].includes(type);
  if (CHROME.includes(type)) return false;
  if (type === "ProductDetail" || type === "ProductInfoTabs" || type === "ProductCustomField") return kind === "product";
  if (type === "CollectionListing") return kind === "collection";
  if (type === "CartContents") return kind === "cart";
  if (type === "BlogListing") return kind === "blogArchive";
  if (type === "BlogPostContent") return kind === "blogPost";
  return true;
}

export function buildPuckConfig(options: { themeVars: Record<string, string>; pageKind?: EditorPageKind }): Config {
  const kind = options.pageKind ?? "custom";
  const components: Record<string, unknown> = {};
  const byCategory: Record<string, string[]> = { layout: [], content: [], store: [], bcom: [] };

  for (const [type, spec] of Object.entries(BLOCK_SPECS) as Array<[BlockType, Spec]>) {
    if (!blockAllowed(type, kind)) continue;
    const def = getBlockDefinition(type);
    if (!RETIRED_FROM_PICKER.includes(type)) byCategory[spec.category]?.push(type);
    components[type] = {
      label: spec.label,
      fields: spec.fields,
      defaultProps: SLOT_BLOCK_TYPES.has(type) ? { ...def.defaultProps, [SLOT_PROP]: [] } : def.defaultProps,
      render: (props: AnyProps) => <EditorBlock type={type} props={props} />,
    };
  }

  return {
    categories: {
      ...Object.fromEntries(
        (Object.keys(CATEGORY_TITLES) as Array<keyof typeof CATEGORY_TITLES>).map((k) => [
          k,
          { title: CATEGORY_TITLES[k], components: byCategory[k] ?? [], defaultExpanded: k !== "layout" },
        ]),
      ),
      // Puck lists every component outside the categories under "Other"; retired blocks stay out of the picker.
      other: { visible: false },
    },
    components,
    root: {
      // Page-level settings (SEO etc.) live on the page record, not in the block document.
      fields: {},
      // The canvas shows the store's own theme: same --bs-* variables the storefront sets.
      render: ({ children }: { children: ReactNode }) => (
        <div className="bsb" style={{ ...(options.themeVars as CSSProperties), background: "var(--bs-bg, #fff)", minHeight: "100vh" }}>
          <FrameBlocks part="header" />
          {children}
          <FrameBlocks part="footer" />
        </div>
      ),
    },
  } as unknown as Config;
}
