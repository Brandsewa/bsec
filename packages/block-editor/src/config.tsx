import type { ComponentType, CSSProperties, ReactNode } from "react";
import type { Config, CustomField, Field } from "@puckeditor/core";
import { SLOT_BLOCK_TYPES, SLOT_PROP, getBlockDefinition, normalizeLengthValue, renderBlockTree, type BlockType, type RenderContext } from "@bs/blocks";
import { mediaField, videoMediaField, fileMediaField } from "./MediaField.tsx";
import { galleryImagesField } from "./GalleryImagesField.tsx";
import { menuField } from "./MenuField.tsx";
import { collectionsField } from "./CollectionsField.tsx";
import { logoSizeField } from "./HeaderFooterPanels.tsx";
import { elementOrderField } from "./ElementOrderField.tsx";
import { accordionFields } from "./sections.tsx";
import { layoutField, slideRadiusField } from "./LayoutField.tsx";
import {
  createBricksLayoutFields,
  bricksRowSelectField,
  bricksRowInputField,
  markdownTextField,
  bricksColorField,
} from "./BricksLayoutFields.tsx";
import { useFrame, useRenderData } from "./context.tsx";
import { ColorPickerSwatch } from "./ColorPickerSwatch.tsx";

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
// Compact "label left, control right" rows (the same look as the layout fields), for the newer widgets.
const rnum = (label: string, min: number, max: number): Field => bricksRowInputField(label, "", "number", min, max) as Field;
const rsel = (label: string, o: Record<string, string>): Field => bricksRowSelectField(label, o) as Field;
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
  render: ({ value, onChange }) => (
    <div>
      <span style={{ fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ColorPickerSwatch
          label={label}
          value={value}
          onChange={onChange}
        />
        <span style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: value ? "#18181b" : "#71717a" }}>
          {value ?? "Theme colour"}
        </span>
      </div>
    </div>
  ),
});

const TONE = { default: "Plain", surface: "Soft background", primary: "Brand colour", dark: "Dark background" };
const ALIGN = { left: "Left", center: "Center", right: "Right" };
const _SPACING = { none: "None", sm: "Small", md: "Medium", lg: "Large", xl: "Extra large" };
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
  Section: {
    label: "Section",
    category: "layout",
    fields: createBricksLayoutFields("Section", {
      [SLOT_PROP]: { type: "slot" },
    }),
  },
  Container: {
    label: "Container",
    category: "layout",
    fields: createBricksLayoutFields("Container", {
      [SLOT_PROP]: { type: "slot" },
    }),
  },
  Block: {
    label: "Block",
    category: "layout",
    fields: createBricksLayoutFields("Block", {
      [SLOT_PROP]: { type: "slot" },
    }),
  },
  Grid: { label: "Grid", category: "layout", fields: { [SLOT_PROP]: { type: "slot" }, columns: num("Columns (desktop)", 1, 6), columnsMobile: num("Columns (mobile)", 1, 2), gap: select("Gap", GAP) } },
  FlexRow: { label: "Flex row", category: "layout", fields: { [SLOT_PROP]: { type: "slot" }, gap: select("Gap", GAP), alignItems: select("Vertical align", ITEMS), justify: select("Horizontal align", { start: "Start", center: "Center", end: "End", between: "Space between" }) } },
  FlexColumn: { label: "Flex column", category: "layout", fields: { [SLOT_PROP]: { type: "slot" }, gap: select("Gap", GAP), alignItems: select("Align", ITEMS) } },
  Spacer: { label: "Spacer", category: "layout", fields: { size: select("Height", { sm: "Small", md: "Medium", lg: "Large", xl: "Extra large" }) } },
  Divider: { label: "Divider", category: "layout", fields: { width: select("Width", WIDTH) } },

  Heading: {
    label: "Heading",
    category: "content",
    fields: createBricksLayoutFields(
      "Heading",
      {
        text: bricksRowInputField("Text", "Heading") as Field,
        level: bricksRowSelectField("HTML tag", [
          { value: "h1", label: "H1" },
          { value: "h2", label: "H2" },
          { value: "h3", label: "H3" },
          { value: "h4", label: "H4" },
          { value: "h5", label: "H5" },
          { value: "h6", label: "H6" },
        ]) as Field,
        align: bricksRowSelectField("Align", [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ]) as Field,
        link: bricksRowInputField("Link", "e.g. /shop or https://...") as Field,
      },
      { includeDisplayControls: false }
    ),
  },
  Text: {
    label: "Text",
    category: "content",
    fields: createBricksLayoutFields(
      "Text",
      {
        text: markdownTextField("Text") as Field,
        tag: bricksRowSelectField("HTML tag", [
          { value: "p", label: "p" },
          { value: "div", label: "div" },
          { value: "span", label: "span" },
        ]) as Field,
        align: bricksRowSelectField("Align", [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ]) as Field,
        link: bricksRowInputField("Link", "e.g. /about or https://...") as Field,
        muted: radio("Softer colour"),
      },
      { includeDisplayControls: false }
    ),
  },
  RichText: {
    label: "Rich text",
    category: "content",
    fields: createBricksLayoutFields(
      "RichText",
      {
        content: area("HTML (formatting tags only)"),
        alignment: bricksRowSelectField("Align", [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ]) as Field,
      },
      { includeDisplayControls: false }
    ),
  },
  Image: {
    label: "Image",
    category: "content",
    fields: createBricksLayoutFields(
      "Image",
      {
        mediaId: mediaField("Image") as Field,
        imageUrl: bricksRowInputField("Image URL", "https://...") as Field,
        alt: bricksRowInputField("Alt text", "Image description") as Field,
        ratio: bricksRowSelectField("Shape / Ratio", [
          { value: "auto", label: "Original" },
          { value: "square", label: "Square (1:1)" },
          { value: "4-3", label: "Standard (4:3)" },
          { value: "16-9", label: "Widescreen (16:9)" },
        ]) as Field,
        objectFit: bricksRowSelectField("Image Layout (Fit)", [
          { value: "cover", label: "Cover (Fill & Crop)" },
          { value: "contain", label: "Contain (Fit inside)" },
          { value: "fill", label: "Fill (Stretch)" },
          { value: "scale-down", label: "Scale Down" },
          { value: "none", label: "None (Original)" },
        ]) as Field,
        objectPosition: bricksRowSelectField("Alignment (Focus)", [
          { value: "center center", label: "Center" },
          { value: "top center", label: "Top Center" },
          { value: "bottom center", label: "Bottom Center" },
          { value: "center left", label: "Center Left" },
          { value: "center right", label: "Center Right" },
          { value: "top left", label: "Top Left" },
          { value: "top right", label: "Top Right" },
          { value: "bottom left", label: "Bottom Left" },
          { value: "bottom right", label: "Bottom Right" },
        ]) as Field,
        rounded: radio("Rounded corners"),
        href: bricksRowInputField("Link", "/collections") as Field,
      },
      { includeDisplayControls: false }
    ),
  },
  Video: {
    label: "Video",
    category: "content",
    fields: createBricksLayoutFields(
      "Video",
      {
        videoType: bricksRowSelectField("Source", [
          { value: "youtube", label: "YouTube / URL" },
          { value: "media", label: "Media Library" },
        ]) as Field,
        mediaId: videoMediaField("Library video") as Field,
        url: bricksRowInputField("Video URL", "YouTube, Vimeo, MP4") as Field,
        posterMediaId: mediaField("Poster image") as Field,
        objectFit: bricksRowSelectField("Video Layout (Fit)", [
          { value: "cover", label: "Cover (Fill & Crop)" },
          { value: "contain", label: "Contain (Fit inside)" },
          { value: "fill", label: "Fill (Stretch)" },
          { value: "scale-down", label: "Scale Down" },
          { value: "none", label: "None" },
        ]) as Field,
        objectPosition: bricksRowSelectField("Alignment (Focus)", [
          { value: "center center", label: "Center" },
          { value: "top center", label: "Top Center" },
          { value: "bottom center", label: "Bottom Center" },
          { value: "center left", label: "Center Left" },
          { value: "center right", label: "Center Right" },
          { value: "top left", label: "Top Left" },
          { value: "top right", label: "Top Right" },
          { value: "bottom left", label: "Bottom Left" },
          { value: "bottom right", label: "Bottom Right" },
        ]) as Field,
        autoplayLoop: radio("Autoplay loop (muted)"),
        controls: radio("Show player controls"),
      },
      { includeDisplayControls: false }
    ),
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
  Button: {
    label: "Button",
    category: "content",
    fields: createBricksLayoutFields(
      "Button",
      {
        text: bricksRowInputField("Text", "Click here") as Field,
        link: bricksRowInputField("Link", "/collections/all") as Field,
        newTab: radio("Open in new tab"),
        styleType: bricksRowSelectField("Button Style", [
          { value: "theme", label: "Theme Preset" },
          { value: "normal", label: "Normal (Solid)" },
          { value: "line", label: "Line (Outline)" },
          { value: "text", label: "Text Button" },
        ]) as Field,
        variant: bricksRowSelectField("Theme Style", [
          { value: "primary", label: "Primary (Solid)" },
          { value: "secondary", label: "Secondary (Soft)" },
          { value: "outline", label: "Outline" },
        ]) as Field,
        icon: bricksRowSelectField("Icon", [
          { value: "none", label: "None" },
          { value: "arrow-right", label: "Arrow Right" },
          { value: "arrow-left", label: "Arrow Left" },
          { value: "chevron-right", label: "Chevron Right" },
          { value: "chevron-left", label: "Chevron Left" },
          { value: "cart", label: "Shopping Cart" },
          { value: "check", label: "Check" },
          { value: "star", label: "Star" },
          { value: "heart", label: "Heart" },
          { value: "external-link", label: "External Link" },
          { value: "plus", label: "Plus" },
          { value: "truck", label: "Truck" },
          { value: "shield", label: "Shield" },
          { value: "gift", label: "Gift" },
          { value: "phone", label: "Phone" },
          { value: "mail", label: "Mail" },
        ]) as Field,
        iconPosition: bricksRowSelectField("Icon Position", [
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ]) as Field,
        iconGap: bricksRowInputField("Icon Gap", "8px") as Field,
        buttonColor: bricksColorField("Button Color") as Field,
        textColor: bricksColorField("Text Color") as Field,
        hoverButtonColor: bricksColorField("Hover Button Color") as Field,
        hoverTextColor: bricksColorField("Hover Text Color") as Field,
        fullWidth: radio("Full width"),
        align: bricksRowSelectField("Align", [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ]) as Field,
      },
      { includeDisplayControls: false }
    ),
  },
  Icon: { label: "Icon", category: "content", fields: { name: select("Icon", ICONS), size: select("Size", { sm: "Small", md: "Medium", lg: "Large" }), align: select("Align", ALIGN) } },
  Link: { label: "Link", category: "content", fields: { label: text("Label"), href: link("Link"), newTab: radio("Open in new tab") } },

  Hero: { label: "Hero banner", category: "store", fields: { eyebrow: text("Small heading"), title: text("Heading"), subtitle: area("Subheading"), ctaText: text("Main button"), ctaLink: link("Main button link"), secondaryCtaText: text("Second button"), secondaryCtaLink: link("Second button link"), backgroundMediaId: mediaField("Background image") as Field, overlayOpacity: num("Image darkening %", 0, 100), alignment: select("Align", ALIGN), tone: select("Colour (no image)", TONE) } },
  Banner: { label: "Announcement bar", category: "store", fields: { text: text("Message"), link: link("Link"), variant: select("Style", { promo: "Promo", info: "Info", warning: "Warning" }) } },
  ProductCarousel: { label: "Product carousel", category: "store", fields: productFields(true) },
  ProductGrid: { label: "Product grid", category: "store", fields: productFields(false) },
  CollectionGrid: { label: "Collection grid", category: "store", fields: { title: text("Heading"), subtitle: text("Description under the heading"), headerAlign: select("Heading and description position", ALIGN), showAll: radio("List every published collection"), collectionSlugs: listField("Collection slugs (ignored when listing every collection)") as Field, columns: select("Cards per row: desktop", { "4": "4", "3": "3", "2": "2" }), columnsTablet: select("Cards per row: tablet", { "2": "2", "1": "1" }), columnsMobile: select("Cards per row: mobile", { "1": "1", "2": "2" }) } },
  BlogPosts: { label: "Recent blog posts", category: "store", fields: { title: text("Heading"), subtitle: text("Description under the heading"), source: select("Which posts", { latest: "Newest posts", featured: "Featured posts", category: "From one category" }), categorySlug: text("Category address (only for 'From one category')"), count: num("How many posts", 1, 12), layout: select("Layout", { grid: "Grid", list: "List", slider: "Slider (swipe sideways)" }), columns: select("Posts per row: desktop", { "4": "4", "3": "3", "2": "2" }), columnsTablet: select("Posts per row: tablet", { "2": "2", "1": "1" }), columnsMobile: select("Posts per row: phone", { "1": "1", "2": "2" }), imageRatio: select("Image shape", { landscape: "Landscape", square: "Square", portrait: "Portrait (4:5)" }), showImage: radio("Image"), showExcerpt: radio("Summary"), excerptLines: select("Summary lines", { "2": "2", "3": "3", "4": "4" }), showDate: radio("Date"), showAuthor: radio("Author"), showCategory: radio("Category label"), showViewAll: radio("'View all' link"), viewAllLabel: text("'View all' link text"), hideWhenEmpty: radio("Hide the section when there are no posts"), tone: select("Background", TONE) } },
  BlogListing: { label: "Blog archive posts", category: "store", fields: { style: select("Blog index style", { magazine: "Magazine: headline, subscribe form, latest posts, a row per category", classic: "Classic: heading and a grid of posts" }), headlineBold: text("Headline (empty = Heading below)"), subtitle: area("Description below the headline"), showSubscribe: radio("Subscribe form (right of the headline on desktop)"), subscribeText: area("Text below the subscribe form"), subscribeLabel: text("Subscribe button text"), subscribePlaceholder: text("Email field placeholder"), latestSideCount: num("Small posts beside the latest post (0 hides them)", 0, 8), showCategorySections: radio("A row of posts for each category"), postsPerCategory: num("Posts in each category row", 1, 8), title: text("Heading (category pages and classic style)"), showCategories: radio("Category links"), layout: select("Layout", { grid: "Grid", list: "List" }), columns: select("Posts per row: desktop", { "4": "4", "3": "3", "2": "2" }), columnsTablet: select("Posts per row: tablet", { "2": "2", "1": "1" }), columnsMobile: select("Posts per row: phone", { "1": "1", "2": "2" }), featuredFirst: radio("Show the first post larger"), imageRatio: select("Image shape", { landscape: "Landscape", square: "Square", portrait: "Portrait (4:5)" }), showImage: radio("Image"), showExcerpt: radio("Summary"), showDate: radio("Date"), showAuthor: radio("Author"), showReadingTime: radio("Reading time"), showCategoryLabel: radio("Category label"), postsPerPage: num("Posts per page (0 = use the blog setting)", 0, 48), emptyText: text("Text when there are no posts") } },
  BlogPostContent: { label: "Blog post", category: "store", fields: { layout: select("Layout", { magazine: "Magazine: picture on top, contents and sidebar beside the text", classic: "Classic: one narrow column" }), tocPosition: select("Table of contents side (desktop)", { left: "Left", right: "Right" }), showSidebar: radio("Sidebar (related posts, subscribe box, categories)"), showAboutCard: radio("About card in the sidebar"), aboutTitle: text("About card title (empty = blog title)"), aboutText: area("About card text (empty = blog description)"), showFeatured: radio("Featured posts in the sidebar (hidden when none are starred)"), featuredCount: num("How many featured posts", 1, 8), showSubscribe: radio("Subscribe box in the sidebar"), subscribeTitle: text("Subscribe box title"), subscribeText: area("Subscribe box text"), subscribePlaceholder: text("Email field placeholder"), subscribeLabel: text("Subscribe button text"), showCategoriesCloud: radio("Category list in the sidebar"), showBreadcrumb: radio("Breadcrumb"), showCategory: radio("Category label"), showDate: radio("Date"), showAuthor: radio("Author"), showReadingTime: radio("Reading time"), featuredImage: select("Featured image", { above: "Above the text", wide: "Wide, above the title", hidden: "Hidden" }), contentWidth: select("Text width", { narrow: "Narrow (easy to read)", normal: "Normal" }), showToc: radio("Table of contents (3 or more headings)"), showShare: radio("Share links"), showRelated: radio("Related posts"), relatedCount: num("How many related posts", 0, 6), showPrevNext: radio("Previous and next post links") } },
  Testimonials: { label: "Testimonials", category: "store", fields: { title: text("Heading"), layout: select("Layout", { grid: "Grid", carousel: "Carousel", single: "Single" }), tone: select("Background", TONE), items: { type: "array", label: "Testimonials", getItemSummary: (i: { author?: string }) => i.author ?? "Testimonial", arrayFields: { author: text("Customer name"), role: text("Role (e.g. Verified buyer)"), quote: area("Testimonial"), rating: num("Rating (1-5)", 1, 5), avatarMediaId: mediaField("Customer photo") as Field }, defaultItemProps: { author: "Customer", quote: "Great product!", rating: 5 } } as Field } },
  Reviews: { label: "Reviews", category: "store", fields: { title: text("Heading"), showAggregate: radio("Show average"), limit: num("How many", 1, 20) } },
  CallToAction: { label: "Call to action", category: "store", fields: { heading: text("Heading"), text: area("Supporting text"), primaryLabel: text("Main button"), primaryHref: link("Main button link"), secondaryLabel: text("Second button (optional)"), secondaryHref: link("Second button link"), backgroundMediaId: mediaField("Background image") as Field, overlayOpacity: num("Image darkening %", 0, 100), tone: select("Colour (no image)", TONE), align: select("Align", { center: "Center", left: "Left", right: "Right" }) } },
  FAQ: { label: "FAQ", category: "store", fields: { title: text("Heading"), items: { type: "array", label: "Questions", getItemSummary: (i: { question?: string }) => i.question ?? "Question", arrayFields: { question: text("Question"), answer: area("Answer") }, defaultItemProps: { question: "Question", answer: "Answer" } } as Field } },
  Gallery: { label: "Gallery", category: "bcom", fields: { title: text("Heading"), description: area("Description under the heading"), headerAlign: rsel("Heading and description alignment", { left: "Left", center: "Middle", right: "Right" }), titleGap: rnum("Space between heading and description (px)", 0, 80), headerGap: rnum("Space between the heading area and the pictures (px)", 0, 120), images: galleryImagesField("Pictures (pick many, drag to reorder)") as Field, layout: rsel("Style", { masonry: "Masonry (each picture keeps its shape)", grid: "Even grid" }), columnsDesktop: rsel("Pictures per row: desktop", { "2": "2", "3": "3", "4": "4", "5": "5", "6": "6" }), columnsTablet: rsel("Pictures per row: tablet", { "1": "1", "2": "2", "3": "3", "4": "4" }), columnsMobile: rsel("Pictures per row: phone", { "1": "1", "2": "2", "3": "3" }), gap: rnum("Space between pictures (px)", 0, 48), radius: rnum("Corner radius (px)", 0, 48), heightMode: rsel("Picture height", { auto: "Automatic", manual: "Fixed height" }), manualHeight: rnum("Fixed height (px)", 80, 800), lightbox: radio("Open in a viewer with arrows and thumbnails when clicked") } },
  Newsletter: { label: "Newsletter", category: "store", fields: { title: text("Heading"), subtitle: text("Subheading"), buttonText: text("Button"), placeholder: text("Email placeholder") } },
  SiteHeader: { label: "Header", category: "store", fields: { menuHandle: menuField("Navigation menu") as Field, logoText: text("Logo text (empty = store logo / name)"), logoMediaId: mediaField("Custom logo image (overrides brand logo)") as Field, logoSize: logoSizeField("Logo size") as Field, layout: select("Layout", { left: "Logo left, menu next to it", navCenter: "Logo left, menu in the middle", logoCenter: "Menu left, logo in the middle", logoRight: "Logo right, menu left", center: "Stacked: logo in the middle, menu below" }), links: { type: "array", label: "Fallback menu links", getItemSummary: (i: { label?: string }) => i.label ?? "Link", arrayFields: { label: text("Label"), href: link("Link") }, defaultItemProps: { label: "Link", href: "/" } } as Field, showSearch: radio("Search icon"), showAccount: radio("Account icon"), showCart: radio("Cart icon"), sticky: radio("Stay at top while scrolling"), tone: select("Background", TONE) } },
  SiteFooter: { label: "Footer", category: "store", fields: { layout: select("Layout", { columns: "Columns: brand, link columns, newsletter", centered: "Centred: brand on top, link columns in a row", compact: "Compact: brand and links side by side" }), logoMediaId: mediaField("Logo image (empty = brand name)") as Field, logoSize: logoSizeField("Logo size") as Field, logoText: text("Brand name (empty = store name)"), about: area("About text"), mobileAccordion: radio("Fold link columns into an accordion on phones"), columns: { type: "array", label: "Link columns", getItemSummary: (i: { title?: string }) => i.title ?? "Column", arrayFields: { title: text("Column title"), menuHandle: menuField("Navigation menu") as Field, links: { type: "array", label: "Fallback links", getItemSummary: (i: { label?: string }) => i.label ?? "Link", arrayFields: { label: text("Label"), href: link("Link") }, defaultItemProps: { label: "Link", href: "/" } } as Field }, defaultItemProps: { title: "Column", links: [] } } as Field, socials: { type: "array", label: "Social links", getItemSummary: (i: { network?: string }) => i.network ?? "Social link", arrayFields: { network: select("Network", { instagram: "Instagram", facebook: "Facebook", x: "X (Twitter)", youtube: "YouTube", linkedin: "LinkedIn", whatsapp: "WhatsApp", email: "Email", website: "Website" }), url: link("Link") }, defaultItemProps: { network: "instagram", url: "https://" } } as Field, socialStyle: select("Social icon style", { plain: "Plain icon", filled: "Filled circle", outline: "Outlined circle" }), socialColor: select("Social icon colour", { text: "Text colour", brand: "Brand colour" }), socialSize: num("Social icon size (px)", 14, 40), showNewsletter: radio("Newsletter signup"), newsletterTitle: text("Newsletter heading"), newsletterText: text("Newsletter text"), copyright: text("Copyright line (empty = automatic)"), tone: select("Background", TONE) } },
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
          showCoupons: toggle("Coupon cards under Add to cart") as Field,
          couponCount: rnum("Coupons shown before View all", 1, 4),
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
  ContactForm: {
    label: "Contact form",
    category: "bcom",
    fields: {
      enabled: radio("Show this form on the store (off hides it)"),
      title: text("Heading"),
      description: area("Text under the heading"),
      formName: text("Form name (shown in the admin inbox)"),
      fieldAlign: rsel("Text alignment in the fields", { left: "Left", center: "Middle", right: "Right" }),
      recipientEmail: text("Send submissions to this email (empty = the store admin email)"),
      showPhone: radio("Phone number field"),
      phoneRequired: radio("Phone number is required"),
      showDropdown: radio("Dropdown list"),
      dropdownLabel: text("Dropdown label"),
      dropdownOptions: text("Dropdown choices (separate with commas)"),
      showMessage: radio("Message box"),
      messageLabel: text("Message label"),
      messageRequired: radio("Message is required"),
      submitLabel: text("Button text"),
      successMessage: text("Thank-you message"),
      consentText: text("Small print under the button (optional)"),
      width: rsel("Content width", WIDTH),
      tone: rsel("Background", TONE),
    },
  },
  ProductCoupons: { label: "Coupon cards", category: "store", fields: { title: text("Heading (empty hides it)"), showCount: rnum("Coupons shown before View all", 1, 4), showViewAll: radio("View all button (opens a side drawer)"), viewAllLabel: text("View all button text") } },
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
          dotsDesktop: radio("Show dots on desktop and tablet too (arrows replace them there by default)"),
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
          iconSize: num("Icon size (px)", 10, 48),
          rowPadding: num("Row height: space above and below each question (px)", 4, 48),
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
  MultiCard: {
    label: "Multi card",
    category: "bcom",
    fields: accordionFields("MultiCard", [
      {
        id: "section",
        title: "Section",
        fields: {
          box: layoutField("Section") as Field,
          width: select("Content width", WIDTH),
          tone: select("Background", TONE),
          sectionBg: colorField("Background colour (overrides the choice above)") as Field,
        },
      },
      {
        id: "heading",
        title: "Heading",
        fields: {
          title: text("Heading (empty hides it)"),
          subtitle: text("Description under the heading"),
          headerAlign: select("Alignment", ALIGN),
        },
      },
      {
        id: "layout",
        title: "Cards per row and slider",
        fields: {
          cardStyle: rsel("Card style", { icon: "Style 1: icon, heading, text, link", image: "Style 2: picture on top, then text" }),
          imageRatio: rsel("Style 2 picture shape", { "16:9": "Wide (16:9)", "4:3": "Standard (4:3)", "1:1": "Square" }),
          perRowDesktop: select("Cards per row: desktop (recommended 3)", { "1": "1", "2": "2", "3": "3", "4": "4" }),
          perRowTablet: select("Cards per row: tablet (recommended 2)", { "1": "1", "2": "2", "3": "3" }),
          perRowMobile: select("Cards per row: phone (recommended 1)", { "1": "1", "2": "2" }),
          tabletLayout: select("Tablet", { grid: "Grid", slider: "Slider (swipe sideways)" }),
          mobileLayout: select("Phone (recommended: slider)", { grid: "Grid", slider: "Slider (swipe sideways)" }),
          gap: num("Space between cards (px)", 0, 64),
        },
      },
      {
        id: "card",
        title: "Card look",
        fields: {
          cardPadding: num("Padding inside each card (px)", 0, 64),
          cardRadius: num("Corner radius (px)", 0, 48),
          borderWidth: num("Border line (px, 0 for none)", 0, 8),
          borderColor: colorField("Border colour (empty uses the theme)") as Field,
          cardBg: colorField("Card background colour (empty is see-through)") as Field,
          cardText: colorField("Card text colour (empty follows the section)") as Field,
          cardBgMediaId: mediaField("Background picture for every card (a card can set its own)") as Field,
          cardOverlay: num("Darkening over a background picture (%)", 0, 80),
          cardMinHeight: num("Minimum card height (px, 0 = automatic)", 0, 600),
        },
      },
      {
        id: "content",
        title: "Card content",
        fields: {
          contentAlign: select("Vertical position (needs a minimum height)", { start: "Top", center: "Middle", end: "Bottom" }),
          textAlign: select("Text alignment", ALIGN),
          elementGap: num("Space between icon, heading, text and link (px)", 0, 48),
          showIcon: radio("Icon or picture"),
          showHeading: radio("Heading"),
          showText: radio("Text"),
          showLink: radio("Link"),
          iconSize: num("Icon size (px)", 16, 120),
          linkStyle: select("Link look", { link: "Text link", button: "Button" }),
        },
      },
      {
        id: "items",
        title: "Cards",
        fields: {
          items: {
            type: "array",
            label: "Cards",
            getItemSummary: (i: { heading?: string }) => i.heading || "Card",
            arrayFields: {
              icon: select("Icon (ignored when a picture is chosen)", ICONS),
              iconMediaId: mediaField("Picture instead of an icon") as Field,
              heading: text("Heading"),
              text: area("Text"),
              linkLabel: text("Link text"),
              linkHref: link("Link"),
              imageMediaId: mediaField("Style 2: picture on top of this card") as Field,
              bgMediaId: mediaField("Background picture for this card") as Field,
            },
            defaultItemProps: { icon: "star", heading: "Heading", text: "Write something helpful for your customers." },
          } as Field,
        },
      },
      {
        id: "slider",
        title: "Slider controls (tablet and phone)",
        fields: {
          arrows: radio("Arrows (tablet)"),
          dots: radio("Page lines (phone)"),
          dotsColor: select("Page line colour", { light: "Light", dark: "Dark", brand: "Theme button colour" }),
          autoplay: radio("Autoplay"),
          interval: num("Seconds per page", 2, 20),
          loop: radio("Loop back to the start"),
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
          badge: select("Label above the product name", { none: "None", category: "Category", brand: "Brand" }),
          showSaleBadge: radio("Sale badge (Save %)"),
          showCompareAt: radio("Crossed-out compare price"),
          startsFrom: select("\u201cStarts from\u201d label", { auto: "When variants differ in price", always: "Always", never: "Never" }),
          showAddToCart: radio("Add-to-cart button on the image"),
          imageRatio: select("Image shape", { square: "Square", portrait: "Portrait (4:5)", landscape: "Landscape (4:3)" }),
          cardStyle: rsel("Card style", { soft: "Soft image tile", bordered: "Bordered card", minimal: "Minimal" }),
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
          dotsDesktop: radio("Show dots on desktop and tablet too (arrows replace them there by default)"),
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
  BlogShowcase: {
    label: "Blog slider",
    category: "bcom",
    fields: accordionFields("BlogShowcase", [
      {
        id: "heading",
        title: "Heading and posts",
        fields: {
          title: text("Heading"),
          subtitle: text("Description under the heading"),
          headerAlign: select("Heading position", { left: "Left", center: "Middle", right: "Right" }),
          source: select("Which posts", { latest: "Newest posts", featured: "Featured posts", category: "From one category" }),
          categorySlug: text("Category address (only for 'From one category')"),
          count: num("How many posts", 1, 12),
          showViewAll: radio("'View all' link"),
          viewAllLabel: text("'View all' link text"),
          hideWhenEmpty: radio("Hide the section when there are no posts"),
        },
      },
      {
        id: "section",
        title: "Section",
        fields: { box: layoutField("Section") as Field, width: select("Content width", WIDTH), tone: select("Background", TONE) },
      },
      {
        id: "layout",
        title: "Cards per row",
        fields: {
          layout: select("Desktop and tablet", { slider: "Slider", grid: "Grid (no sliding)" }),
          perViewDesktop: num("Cards per row: desktop (recommended 3)", 1, 4),
          perViewTablet: num("Cards per row: tablet (recommended 2)", 1, 3),
          perViewMobile: num("Cards per row: phone (recommended 1)", 1, 2),
          mobileLayout: select("Phone", { slider: "Slider (swipe sideways)", grid: "Grid", list: "List (one post per row)" }),
          listThumbnail: radio("Phone list: small picture beside each post"),
          gap: num("Space between cards (px)", 0, 48),
        },
      },
      {
        id: "card",
        title: "Card",
        fields: {
          showImage: radio("Picture"),
          imageRatio: select("Picture shape", { landscape: "Landscape", square: "Square", portrait: "Portrait (4:5)" }),
          showCategory: radio("Category label"),
          showExcerpt: radio("Summary"),
          excerptLines: select("Summary lines", { "2": "2", "3": "3", "4": "4" }),
          showDate: radio("Date"),
          showAuthor: radio("Author"),
        },
      },
      {
        id: "slider",
        title: "Slider controls",
        fields: {
          arrows: radio("Arrows (tablet and desktop)"),
          dots: radio("Page lines (phone)"),
          dotsDesktop: radio("Also show page lines on desktop and tablet"),
          dotsColor: select("Page line colour", { light: "Light", dark: "Dark", brand: "Theme button colour" }),
          autoplay: radio("Autoplay"),
          interval: num("Seconds per page", 2, 20),
          loop: radio("Loop back to the start"),
        },
      },
    ]),
  },
  CollectionProducts: {
    label: "Collection products (grid only)",
    category: "store",
    fields: accordionFields("CollectionProducts", [
      {
        id: "section",
        title: "Section",
        fields: {
          box: layoutField("Section") as Field,
          width: select("Content width", WIDTH),
          tone: select("Background", TONE),
        },
      },
      {
        id: "text",
        title: "Collection text (off to place your own around the grid)",
        fields: {
          showTitle: radio("Collection name as the page heading (keep one heading on the page)"),
          showDescription: radio("Short description under the name"),
          showLongDescription: radio("Long description below the products"),
        },
      },
      {
        id: "grid",
        title: "Grid",
        fields: {
          columns: select("Cards per row: desktop (recommended 4)", { "4": "4", "3": "3", "2": "2" }),
          columnsTablet: select("Cards per row: tablet (recommended 2)", { "2": "2", "1": "1" }),
          columnsMobile: select("Cards per row: phone (recommended 2)", { "1": "1", "2": "2" }),
          pageSize: select("Products per load (recommended 12)", { "12": "12", "24": "24", "36": "36" }),
          defaultView: select("Default view", { grid: "Grid", list: "List" }),
          showViewToggle: radio("Grid / list switch"),
        },
      },
      {
        id: "filters",
        title: "Sort and filters",
        fields: {
          showFilters: radio("Sort and filters"),
          filterMenuHandle: menuField("Filter menu") as Field,
          filtersCollapsible: radio("Filter sidebar can be hidden"),
        },
      },
      {
        id: "cards",
        title: "Product cards",
        fields: {
          imageRatio: select("Image shape", { square: "Square", portrait: "Portrait (4:5)" }),
          cardStyle: rsel("Card style", { borderless: "Borderless", bordered: "Bordered", minimal: "Minimal" }),
          hoverSecondImage: radio("Second image on hover"),
          showSaleBadge: radio("Discount badge"),
          showCategoryBadge: radio("Category label above the product name"),
          showRatings: radio("Ratings"),
          showAddToCart: radio("Add to cart icon on image"),
          showQuickAdd: radio("Quick-buy popup for products with variants"),
          showViewProduct: radio("View product link in popup"),
        },
      },
    ]),
  },
  CartContents: { label: "Cart contents", category: "store", fields: { heading: text("Page heading"), checkoutLabel: text("Checkout button label"), showFreeShippingBar: radio("Free-shipping progress bar (uses the store's shipping settings)"), showTrustPoints: radio("Reassurance lines under the button"), trustPoints: linesField("Reassurance lines (one per line, max 4)", 4) as Field, stickyMobileCheckout: radio("Phone: total and checkout bar while scrolling"), showContinueShopping: radio("Continue shopping link"), summaryPosition: select("Order summary", { right: "Right", left: "Left" }), stickySummary: radio("Keep summary in view while scrolling"), showDiscountCode: radio("Discount code box"), showShippingEstimator: radio("Shipping estimator") } },
  CollectionListing: { label: "Collection products", category: "store", fields: { filterMenuHandle: menuField("Filter menu") as Field, columns: select("Cards per row: desktop", { "4": "4", "3": "3", "2": "2" }), columnsTablet: select("Cards per row: tablet", { "2": "2", "1": "1" }), columnsMobile: select("Cards per row: phone", { "1": "1", "2": "2" }), pageSize: select("Products per load", { "12": "12", "24": "24", "36": "36" }), defaultView: select("Default view", { grid: "Grid", list: "List" }), showViewToggle: radio("Grid / list switch"), imageRatio: select("Image shape", { square: "Square", portrait: "Portrait (4:5)" }), cardStyle: rsel("Card style", { borderless: "Borderless", bordered: "Bordered", minimal: "Minimal" }), hoverSecondImage: radio("Second image on hover"), showSaleBadge: radio("Discount badge"), showCategoryBadge: radio("Category label above the product name"), showRatings: radio("Ratings"), showAddToCart: radio("Add to cart icon on image"), showQuickAdd: radio("Quick-buy popup for products with variants"), showViewProduct: radio("View product link in popup"), showBreadcrumb: radio("Breadcrumb"), showFilters: radio("Sort and filters"), filtersCollapsible: radio("Filter sidebar can be hidden"), showDescription: radio("Collection description") } },
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

const blockMarker = (id: unknown) => String(id ?? "").replace(/[^A-Za-z0-9_-]/g, "");

/**
 * CSS that gives a Block's Puck wrapper the Block's width for each device (desktop, then tablet and mobile, which stack to
 * the full line unless they set their own width: same rule as BlockView). Empty when the Block has no width of its own, so
 * it keeps sharing the row. Values are length-validated by the block schema and normalised by `normalizeLengthValue`.
 */
export function blockWidthCss(
  id: unknown,
  props: { sizing?: { width?: string }; responsive?: { tablet?: { sizing?: { width?: string } }; mobile?: { sizing?: { width?: string } } } },
): string {
  const d = normalizeLengthValue(props.sizing?.width);
  const marker = blockMarker(id);
  if (!d || !marker) return "";
  const t = normalizeLengthValue(props.responsive?.tablet?.sizing?.width) ?? "100%";
  const m = normalizeLengthValue(props.responsive?.mobile?.sizing?.width) ?? t;
  const sel = `[data-puck-dropzone] > [data-puck-component]:has(> i[data-blk="${marker}"])`;
  const rule = (w: string) => `${sel}{flex:0 1 auto;width:${w}}`;
  return `${rule(d)}@media(max-width:1023px){${rule(t)}}@media(max-width:767px){${rule(m)}}`;
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

  const rendered = def.render({ props: effective, children, ctx });
  if (type !== "Block") return rendered;
  // The wrapper Puck puts around a Block is its flex item on the canvas, so the Block's width has to size the wrapper.
  const css = blockWidthCss(id, effective as { sizing?: { width?: string }; responsive?: { tablet?: { sizing?: { width?: string } }; mobile?: { sizing?: { width?: string } } } });
  return (
    <>
      {rendered}
      {css ? (
        <>
          <i hidden data-blk={blockMarker(id)} />
          <style>{css}</style>
        </>
      ) : null}
    </>
  );
}

/** Which kind of theme page is being edited; limits the block picker to blocks that make sense there. */
export type EditorPageKind = "home" | "collections" | "collection" | "product" | "cart" | "blogArchive" | "blogPost" | "header" | "footer" | "custom";

const ONLY: Record<"header" | "footer", BlockType[]> = {
  header: ["SiteHeader", "Banner"],
  footer: ["SiteFooter", "Newsletter", "UspStrip", "Banner", "Heading", "Text", "Divider", "Spacer"],
};
const CHROME: BlockType[] = ["SiteHeader", "SiteFooter"];
/** Still drawn when a page already uses them (templates, saved pages), but no longer offered in the block picker. */
export const RETIRED_FROM_PICKER: BlockType[] = [
  // The full "Collection page" block: new collection pages use "Collection products (grid only)" (CollectionProducts) instead.
  "CollectionListing",
  // Old layout widgets retired in favor of Bricks Section, Container & Block
  "Grid",
  "FlexRow",
  "FlexColumn",
  "Spacer",
  "Divider",
  // Old content & store widgets retired in favor of brand custom widgets
  "FileDownload",
  "RichText",
  "Icon",
  "Link",
  "CallToAction",
  "ProductGrid",
  "ProductCarousel",
  "CollectionGrid",
  "Hero",
  "Banner",
  "Testimonials",
  "Reviews",
  "FAQ",
  "Newsletter",
  "UspStrip",
  "BlogPosts",
];

export function blockAllowed(type: BlockType, kind: EditorPageKind): boolean {
  if (kind === "header" || kind === "footer") return ONLY[kind].includes(type);
  if (CHROME.includes(type)) return false;
  if (type === "ProductDetail" || type === "ProductInfoTabs" || type === "ProductCustomField" || type === "ProductCoupons") return kind === "product";
  if (type === "CollectionListing" || type === "CollectionProducts") return kind === "collection";
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
