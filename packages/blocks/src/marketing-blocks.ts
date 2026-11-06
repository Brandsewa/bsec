import { z } from "zod";
import type { BlockDefinition, BlockInstance, BlockType } from "./types.ts";
import { hexColorSchema, hrefSchema, iconNameSchema } from "./common.ts";
import { HEADING_LEVELS, THEME_FONTS, googleFontsHref, resolveBodySizes, resolveHeadingSizes, resolveThemeTokens, type ThemeTokensLike } from "./theme-vars.ts";
import { childrenOf } from "./tree.ts";
import * as V from "./views-marketing.tsx";

/*
 * Fixed sections of the platform's own website (ADR-042): editable words, no layout options, so a page cannot drift from
 * the design. Only the website record may use them, and the website uses nothing else (`assertBlocksFit...` in the domain).
 */

const line = z.string().min(1).max(200);
const para = z.string().min(1).max(600);
const iconItem = z.object({ icon: iconNameSchema.default("check"), label: line });

/** Keep the section's own top and bottom padding. Off, the widget draws none, so a Section or Container around it sets the spacing. */
const defaultPadding = z.boolean().default(true);

export const MkHeroSchema = z.object({
  defaultPadding,
  stamp: z.string().max(80).default(""),
  title: z.string().min(1).max(160),
  lead: z.string().max(600).default(""),
  showNameChecker: z.boolean().default(true),
  fine: z.string().max(160).default(""),
});
export type MkHeroProps = z.infer<typeof MkHeroSchema>;

export const MkIncludedSchema = z.object({ defaultPadding, label: line, items: z.array(iconItem).min(1).max(8) });
export type MkIncludedProps = z.infer<typeof MkIncludedSchema>;

export const MkStatementSchema = z.object({ defaultPadding, text: para, muted: z.string().max(600).default("") });
export type MkStatementProps = z.infer<typeof MkStatementSchema>;

export const MkFeaturesSchema = z.object({
  defaultPadding,
  /** Space inside each card, left and right, in pixels (phones). */
  cardSidePadding: z.number().int().min(0).max(64).default(16),
  eyebrow: z.string().max(80).default(""),
  title: line,
  intro: z.string().max(600).default(""),
  tone: z.enum(["default", "soft"]).default("soft"),
  items: z.array(z.object({ icon: iconNameSchema.optional(), title: line, body: para })).min(1).max(12),
  /** On phones each card folds to its title with a drop-down arrow. */
  mobileAccordion: z.boolean().default(true),
  iconPosition: z.enum(["right", "left"]).default("right"),
  iconStyle: z.enum(["plus", "chevron"]).default("plus"),
  /** Open/close icon size in pixels. */
  iconSize: z.number().int().min(10).max(48).default(18),
  /** Space above and below each folded title in pixels. */
  rowPadding: z.number().int().min(4).max(48).default(14),
  singleOpen: z.boolean().default(false),
  openFirst: z.boolean().default(false),
});
export type MkFeaturesProps = z.infer<typeof MkFeaturesSchema>;

export const MkStepsSchema = z.object({
  defaultPadding,
  label: line,
  items: z.array(z.object({ icon: iconNameSchema.default("check"), title: line, body: para })).min(1).max(6),
});
export type MkStepsProps = z.infer<typeof MkStepsSchema>;

export const MkBandSchema = z.object({
  defaultPadding,
  title: line,
  items: z.array(z.object({ name: z.string().min(1).max(40), note: z.string().max(120).default("") })).min(1).max(8),
});
export type MkBandProps = z.infer<typeof MkBandSchema>;

export const MkFaqSchema = z.object({
  eyebrow: z.string().max(80).default("FAQ"),
  title: line,
  items: z.array(z.object({ question: line, answer: z.string().min(1).max(1500) })).min(1).max(30),
});
export type MkFaqProps = z.infer<typeof MkFaqSchema>;

export const MkFinalCallSchema = z.object({
  defaultPadding,
  title: line,
  text: z.string().max(300).default(""),
  showPlansLink: z.boolean().default(true),
});
export type MkFinalCallProps = z.infer<typeof MkFinalCallSchema>;

export const MkDocHeaderSchema = z.object({
  defaultPadding,
  eyebrow: z.string().max(80).default(""),
  title: z.string().min(1).max(200),
  intro: z.string().max(600).default(""),
});
export type MkDocHeaderProps = z.infer<typeof MkDocHeaderSchema>;

export const MkDocSectionSchema = z.object({
  heading: z.string().max(200).default(""),
  /** Markdown: bold, italic, links and lists. Sanitized when drawn (ADR-009). */
  body: z.string().max(8000).default(""),
  checks: z.array(line).max(20).default([]),
  after: z.string().max(4000).default(""),
});
export type MkDocSectionProps = z.infer<typeof MkDocSectionSchema>;

export const MkValuesSchema = z.object({
  heading: z.string().max(200).default(""),
  items: z.array(z.object({ icon: iconNameSchema.default("check"), text: z.string().min(1).max(200) })).min(1).max(6),
});
export type MkValuesProps = z.infer<typeof MkValuesSchema>;

export const MkPricingSchema = z.object({
  defaultPadding,
  heading: z.string().max(200).default("Plans you can read in one go."),
  description: z.string().max(400).default("Prices in rupees, plus GST. Every plan starts with a 14-day free trial."),
});
export type MkPricingProps = z.infer<typeof MkPricingSchema>;

/** The website's colours and font. Held on the Header page and applied site-wide; an empty colour keeps the built-in one. */
const themeHex = z.union([hexColorSchema, z.literal("")]).default("");
const themeColours = z.object({ primary: themeHex, primaryInk: themeHex, background: themeHex, text: themeHex });
export const WEBSITE_FONTS = {
  default: { label: "Default (Geist)", family: null, google: null },
  inter: { label: "Inter", family: "Inter", google: "Inter:wght@400;500;600;700" },
  "dm-sans": { label: "DM Sans", family: "DM Sans", google: "DM+Sans:wght@400;500;600;700" },
  poppins: { label: "Poppins", family: "Poppins", google: "Poppins:wght@400;500;600;700" },
  lora: { label: "Lora", family: "Lora", google: "Lora:wght@400;500;600;700" },
  playfair: { label: "Playfair Display", family: "Playfair Display", google: "Playfair+Display:wght@400;500;600;700" },
} as const;
export const MkThemeSchema = z.object({
  /** The store theme tokens (colours, fonts, corners, buttons, layout, icons), edited with the store's Theme settings. `darkColors` holds the dark mode set. */
  tokens: z.record(z.string(), z.unknown()).default({}),
  // Earlier quick settings, still honoured when no tokens are set.
  light: themeColours.default({ primary: "", primaryInk: "", background: "", text: "" }),
  dark: themeColours.default({ primary: "", primaryInk: "", background: "", text: "" }),
  font: z.enum(["default", "inter", "dm-sans", "poppins", "lora", "playfair"]).default("default"),
});
export type MkThemeProps = z.infer<typeof MkThemeSchema>;

const RADIUS_PX: Record<string, string> = { none: "0", sm: "4px", md: "8px", lg: "14px", full: "9999px" };
/** Website parts that follow the "cards, images and fields" corner setting, and those that follow the button corners. */
const CARD_SELECTORS = [".win", ".joined", ".tabs", ".bm-su-card", ".doc .box", ".lock", ".bm-panel", ".claim", ".stats div", ".spark", ".attrs span", ".payopts span", ".chat p", ".bm-input", ".bm-opt"];
const BUTTON_SELECTORS = [".btn", ".bm-pill", ".bm-outline", ".seg", ".iconbtn"];

/** The website palette variables a set of store colours changes. Only colours that were set are emitted, so the built-in palette stays for the rest. */
function paletteVars(c: Record<string, string | undefined>): string {
  const bg = c["siteBackground"] || c["background"];
  const out: Array<[string, string | undefined]> = [
    ["--bg", bg],
    ["--ink", c["lightHeading"]],
    ["--mut", c["lightText"]],
    ["--surface", c["lightBackground"]],
    ["--soft", c["lightBackground"] ? `color-mix(in srgb, ${c["lightBackground"]} 55%, ${bg ?? "var(--bg)"})` : undefined],
    ["--pri", c["lightButton"] || c["primary"]],
    ["--pri-ink", c["lightButtonText"]],
  ];
  const ink = c["lightHeading"];
  if (ink) {
    out.push(["--dim", `color-mix(in srgb, ${ink} 55%, ${bg ?? "var(--bg)"})`], ["--line", `color-mix(in srgb, ${ink} 12%, ${bg ?? "var(--bg)"})`], ["--line2", `color-mix(in srgb, ${ink} 22%, ${bg ?? "var(--bg)"})`]);
  }
  return out.filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(";");
}

/** CSS for the website's theme settings, scoped to `.mk`, and the Google Fonts stylesheet it needs. Empty when nothing is set. */
export function websiteThemeCss(theme: MkThemeProps | null | undefined): { css: string; fontsHref: string | null } {
  if (!theme) return { css: "", fontsHref: null };
  const t = theme.tokens as ThemeTokensLike & { darkColors?: Record<string, string> };
  const hasTokens = Object.keys(theme.tokens).length > 0;
  const css: string[] = [];
  let fontsHref: string | null;

  if (hasTokens) {
    const light = paletteVars((t.colors ?? {}) as Record<string, string | undefined>);
    const dark = paletteVars(t.darkColors ?? {});
    if (light) css.push(`.mk{${light}}`);
    if (dark) css.push(`[data-theme=dark] .mk{${dark}}`);
    const fonts = t.fonts ?? {};
    const quote = (f: unknown) => (typeof f === "string" && (THEME_FONTS as readonly string[]).includes(f) ? `"${f}"` : null);
    const body = quote(fonts["body"]);
    const heading = quote(fonts["heading"]);
    if (body) css.push(`.mk{--sans:${body},system-ui,sans-serif}`);
    const hw = fonts["headingWeight"];
    if (heading || hw) css.push(`.mk h1,.mk h2,.mk h3,.mk h4{${heading ? `font-family:${heading},system-ui,sans-serif;` : ""}${hw ? `font-weight:${hw}` : ""}}`);
    if (fonts["bodyWeight"]) css.push(`.mk{font-weight:${fonts["bodyWeight"]}}`);
    const radius = t.radius ? RADIUS_PX[t.radius] : undefined;
    if (radius) css.push(`${CARD_SELECTORS.map((s) => `.mk ${s}`).join(",")}{border-radius:${radius}}`);
    const bRadius = t.buttons?.radius ? RADIUS_PX[t.buttons.radius] : radius;
    if (bRadius) css.push(`${BUTTON_SELECTORS.map((s) => `.mk ${s}`).join(",")}{border-radius:${bRadius}}`);
    if (t.buttons?.uppercase) css.push(`.mk .btn,.mk .bm-pill{text-transform:uppercase;letter-spacing:.04em}`);
    if (t.buttons?.darkBg) css.push(`.mk .btn.pri{background:${t.buttons.darkBg};border-color:${t.buttons.darkBg}}`);
    if (t.buttons?.darkText) css.push(`.mk .btn.pri{color:${t.buttons.darkText}}`);
    if (t.buttons?.style === "outline") css.push(`.mk .btn.pri{background:transparent;color:var(--pri)}`);
    const widthOf = (d: "desktop" | "tablet" | "mobile") => {
      const w = t.layout?.[d]?.siteWidth;
      return typeof w === "string" && /^[0-9.]+(px|%|rem)$/.test(w) ? w : null;
    };
    const [dw, tw, mw] = [widthOf("desktop"), widthOf("tablet"), widthOf("mobile")];
    if (dw) css.push(`@media(min-width:1024px){.mk .wrap{max-width:${dw}}}`);
    if (tw) css.push(`@media(min-width:768px) and (max-width:1023px){.mk .wrap{max-width:${tw}}}`);
    if (mw) css.push(`@media(max-width:767px){.mk .wrap{max-width:${mw}}}`);
    // Heading and body sizes per device, for the website's own sections.
    if (t.fontSizes) {
      const sizes = resolveHeadingSizes(t);
      const body = resolveBodySizes(t);
      const rules = (d: "desktop" | "tablet" | "mobile") =>
        `${HEADING_LEVELS.map((l) => `.mk.mk.mk ${l}{font-size:${sizes[l][d]}px}`).join("")}.mk.mk.mk{font-size:${body[d]}px}`;
      css.push(`@media(min-width:1024px){${rules("desktop")}}@media(min-width:768px) and (max-width:1023px){${rules("tablet")}}@media(max-width:767px){${rules("mobile")}}`);
    }
    // The store widgets on website pages read --bs-*: hand them the settings that were set.
    const bs = resolveThemeTokens(null, t) as Record<string, string>;
    const keep: RegExp[] = [];
    if (t.fontSizes) keep.push(/^--bs-(h[1-6]|body)-[dtm]$/);
    if (t.fonts?.["heading"]) keep.push(/^--bs-font-heading$/);
    if (t.fonts?.["body"]) keep.push(/^--bs-font-body$/);
    if (t.fonts?.["headingWeight"]) keep.push(/^--bs-heading-weight$/);
    if (t.fonts?.["bodyWeight"]) keep.push(/^--bs-body-weight$/);
    if (t.radius) keep.push(/^--bs-radius$/);
    if (t.buttons) keep.push(/^--bs-btn-(radius|pad|fs|case)$/);
    if (t.icons) keep.push(/^--bs-icon-(size|weight|color-dark|color-light)$/);
    // Page width and the Section / Container spacing: store layouts read these, so a Container on a website page is as wide as the theme says.
    if (t.layout) keep.push(/^--bs-site-w-[dtm]$/, /^--bs-(sec|cnt)-[dtm]-/);
    const widgetVars = Object.entries(bs).filter(([k]) => keep.some((r) => r.test(k))).map(([k, v]) => `${k}:${v}`);
    if (widgetVars.length > 0) css.push(`.mk{${widgetVars.join(";")}}`);
    fontsHref = googleFontsHref(t);
  } else {
    // Earlier quick settings.
    const vars = (c: MkThemeProps["light"]) =>
      [["--pri", c.primary], ["--pri-ink", c.primaryInk], ["--bg", c.background], ["--ink", c.text]].filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(";");
    const light = vars(theme.light);
    const dark = vars(theme.dark);
    if (light) css.push(`.mk{${light}}`);
    if (dark) css.push(`[data-theme=dark] .mk{${dark}}`);
    const font = WEBSITE_FONTS[theme.font];
    if (font.family) css.push(`.mk{--sans:"${font.family}",system-ui,sans-serif}`);
    fontsHref = font.google ? `https://fonts.googleapis.com/css2?family=${font.google}&display=swap` : null;
  }
  return { css: css.join(""), fontsHref };
}

export const MkCompanySchema = z.object({ heading: z.string().max(200).default(""), after: z.string().max(4000).default("") });
export type MkCompanyProps = z.infer<typeof MkCompanySchema>;


/* ------------------------------------------------------------------ */
/* Header and footer of the website. Defaults are today's layout.      */
/* ------------------------------------------------------------------ */

const footerLink = z.object({ label: z.string().min(1).max(60), href: hrefSchema });
const footerColumn = z.object({ title: z.string().min(1).max(40), links: z.array(footerLink).max(10) });

/** Filled in on the server from Super Admin > Branding when the page is drawn; never edited or stored with the page. */
const brandLogoSchema = z
  .object({
    dark: z.object({ url: z.string(), alt: z.string().optional() }).nullable(),
    light: z.object({ url: z.string(), alt: z.string().optional() }).nullable(),
  })
  .nullable()
  .default(null);

export const MkHeaderSchema = z.object({
  brandLogo: brandLogoSchema,
  brand: z.string().min(1).max(40).default("BCOM"),
  /** Links come from this menu (Storefront > Navigation); the built-in links show while it has none. */
  menuHandle: z.string().max(80).default("header"),
  loginLabel: z.string().max(40).default("Log in"),
  loginHref: hrefSchema.default("https://admin.bcom.si"),
  ctaLabel: z.string().max(40).default("Start free"),
  ctaHref: hrefSchema.default("/signup"),
  showThemeToggle: z.boolean().default(true),
  /** Logo left with the menu beside it, logo left with the menu in the middle, or the logo in the middle with the menu on the left. */
  layout: z.enum(["left", "nav-center", "logo-center"]).default("left"),
});
export type MkHeaderProps = z.infer<typeof MkHeaderSchema>;

export const MK_HEADER_LINKS: Array<{ label: string; href: string }> = [
  { label: "Features", href: "/#ready" },
  { label: "AI shopping", href: "/#ai" },
  { label: "Pricing", href: "/#pricing" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export const MK_FOOTER_COLUMNS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#ready" },
      { label: "AI shopping", href: "/#ai" },
      { label: "Pricing", href: "/pricing" },
      { label: "Start free trial", href: "/signup" },
      { label: "Log in", href: "https://admin.bcom.si" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", href: "/about" },
      { label: "Contact us", href: "/contact" },
      { label: "Brand Sewa", href: "https://brandsewa.com" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of service", href: "/terms" },
      { label: "Privacy policy", href: "/privacy" },
      { label: "Refund and cancellation", href: "/refund-policy" },
      { label: "Delivery policy", href: "/shipping-policy" },
    ],
  },
];

export const MkFooterSchema = z.object({
  brandLogo: brandLogoSchema,
  brand: z.string().min(1).max(40).default("BCOM"),
  /** Markdown: bold, italic and links. */
  about: z.string().max(400).default("BCOM (bcom.si) is a product of [Brand Sewa Digital Private Limited](https://brandsewa.com)."),
  contact: z.string().max(400).default("Hill Cart Road, Darjeeling, West Bengal 734101, India\n\n[info@bcom.si](mailto:info@bcom.si) · [support@bcom.si](mailto:support@bcom.si)"),
  columns: z.array(footerColumn).max(4).default(MK_FOOTER_COLUMNS),
  /** `{year}` becomes the current year. */
  legal: z
    .string()
    .max(600)
    .default("© {year} Brand Sewa Digital Private Limited. CIN U74999WB2021PTC248925 · GSTIN 19AAKCB2303E1Z2. Chats, brands, orders and figures in the previews on this site are illustrations."),
});
export type MkFooterProps = z.infer<typeof MkFooterSchema>;

/** Widgets of the store builder that also work on website pages: layout and basic elements, nothing that needs a store. */
export const WEBSITE_GENERIC_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "Section", "Container", "Block", "Heading", "Text", "Image", "Video", "Button", "Gallery", "ImageBanner", "FaqSection", "MultiCard", "TrustStrip", "BlogShowcase",
]);
const WEBSITE_CHROME_TYPES: ReadonlySet<string> = new Set(["MkHeader", "MkFooter"]);

const only = (blocks: BlockInstance[], ok: (type: string) => boolean) => everyBlock(blocks).every((b) => ok(b.type));
/** What a website page may hold: website sections and the generic widgets. */
export const isWebsitePageBlockSet = (blocks: BlockInstance[]): boolean =>
  only(blocks, (t) => (MARKETING_BLOCK_TYPES.has(t) && !WEBSITE_CHROME_TYPES.has(t)) || WEBSITE_GENERIC_BLOCK_TYPES.has(t));
/** The header page holds the header and the announcement bar; the footer page holds the footer. */
export const isWebsiteHeaderBlockSet = (blocks: BlockInstance[]): boolean => only(blocks, (t) => t === "MkHeader" || t === "Banner" || t === "MkTheme");
export const isWebsiteFooterBlockSet = (blocks: BlockInstance[]): boolean => only(blocks, (t) => t === "MkFooter");
/** The blog layouts of the website: the listing or the post body, plus the generic widgets. */
export const isWebsiteBlogArchiveBlockSet = (blocks: BlockInstance[]): boolean => only(blocks, (t) => t === "BlogListing" || WEBSITE_GENERIC_BLOCK_TYPES.has(t));
export const isWebsiteBlogPostBlockSet = (blocks: BlockInstance[]): boolean => only(blocks, (t) => t === "BlogPostContent" || WEBSITE_GENERIC_BLOCK_TYPES.has(t));
export const isWebsiteBlockSet = (blocks: BlockInstance[]): boolean =>
  isWebsitePageBlockSet(blocks) || isWebsiteHeaderBlockSet(blocks) || isWebsiteFooterBlockSet(blocks);

/**
 * The store theme variables the generic widgets read (`--bs-*`), with the colours pointing at the website's own palette
 * so the widgets follow light and dark. Set on the `.mk` root, where those palette variables are defined.
 */
export const WEBSITE_BLOCK_VARS: Record<string, string> = {
  ...(resolveThemeTokens(null, null) as Record<string, string>),
  "--bs-primary": "var(--pri)", "--bs-primary-fg": "var(--pri-ink)", "--bs-accent": "var(--ink)", "--bs-accent1": "var(--ink)",
  "--bs-surface": "var(--surface)", "--bs-site-bg": "var(--bg)", "--bs-bg": "var(--bg)", "--bs-text": "var(--mut)",
  "--bs-light-heading": "var(--ink)", "--bs-light-text": "var(--mut)", "--bs-light-bg": "var(--soft)",
  "--bs-light-btn-bg": "var(--pri)", "--bs-light-btn-fg": "var(--pri-ink)",
  "--bs-muted": "var(--dim)", "--bs-border": "var(--line)",
  "--bs-btn-bg": "var(--pri)", "--bs-btn-fg": "var(--pri-ink)", "--bs-btn-bd": "var(--pri)",
  "--bs-btn-light-bg": "var(--surface)", "--bs-btn-light-fg": "var(--ink)", "--bs-btn-light-bd": "var(--line2)",
  "--bs-radius": "8px", "--bs-btn-radius": "6px", "--bs-heading-weight": "600",
  "--bs-font-heading": "var(--sans)", "--bs-font-body": "var(--sans)",
};

const block = <T,>(type: BlockType, schema: z.ZodType<T>, defaultProps: T, render: BlockDefinition<T>["render"]): BlockDefinition<T> => ({
  type,
  version: 1,
  schema,
  defaultProps,
  render,
});

export const MARKETING_BLOCK_DEFINITIONS = {
  MkHero: block("MkHero", MkHeroSchema, { defaultPadding: true, stamp: "", title: "A clear headline for this page", lead: "One or two sentences on what this page offers.", showNameChecker: true, fine: "" }, V.MkHeroView),
  MkIncluded: block("MkIncluded", MkIncludedSchema, { defaultPadding: true, label: "Included on every plan", items: [{ icon: "check", label: "A point" }] }, V.MkIncludedView),
  MkStatement: block("MkStatement", MkStatementSchema, { defaultPadding: true, text: "A short statement.", muted: "" }, V.MkStatementView),
  MkFeatures: block("MkFeatures", MkFeaturesSchema, { defaultPadding: true, cardSidePadding: 16, eyebrow: "", title: "What you get", intro: "", tone: "soft", items: [{ title: "A feature", body: "What it does for the store." }], mobileAccordion: true, iconPosition: "right", iconStyle: "plus", iconSize: 18, rowPadding: 14, singleOpen: false, openFirst: false }, V.MkFeaturesView),
  MkSteps: block("MkSteps", MkStepsSchema, { defaultPadding: true, label: "How it works", items: [{ icon: "check", title: "A step", body: "What happens in this step." }] }, V.MkStepsView),
  MkBand: block("MkBand", MkBandSchema, { defaultPadding: true, title: "A short line on a dark band.", items: [{ name: "Name", note: "A short note" }] }, V.MkBandView),
  MkFaq: block("MkFaq", MkFaqSchema, { eyebrow: "FAQ", title: "Straight answers.", items: [{ question: "A question?", answer: "A clear answer." }] }, V.MkFaqView),
  MkFinalCall: block("MkFinalCall", MkFinalCallSchema, { defaultPadding: true, title: "Open your store today.", text: "14-day free trial. No card needed to start.", showPlansLink: true }, V.MkFinalCallView),
  MkDocHeader: block("MkDocHeader", MkDocHeaderSchema, { defaultPadding: true, eyebrow: "", title: "Page title", intro: "" }, V.MkDocHeaderView),
  MkDocSection: block("MkDocSection", MkDocSectionSchema, { heading: "Section heading", body: "Write this section here.", checks: [], after: "" }, V.MkDocSectionView),
  MkValues: block("MkValues", MkValuesSchema, { heading: "", items: [{ icon: "check", text: "A short point." }] }, V.MkValuesView),
  MkHeader: block("MkHeader", MkHeaderSchema, MkHeaderSchema.parse({}), V.MkHeaderView),
  MkFooter: block("MkFooter", MkFooterSchema, MkFooterSchema.parse({}), V.MkFooterView),
  MkTheme: block("MkTheme", MkThemeSchema, MkThemeSchema.parse({}), V.MkThemeView),
  MkPricing: block("MkPricing", MkPricingSchema, MkPricingSchema.parse({}), V.MkPricingView),
  MkCompany: block("MkCompany", MkCompanySchema, { heading: "The company", after: "" }, V.MkCompanyView),
} satisfies Partial<Record<BlockType, BlockDefinition<never> | BlockDefinition<any>>>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const MARKETING_BLOCK_TYPES = new Set<string>(Object.keys(MARKETING_BLOCK_DEFINITIONS));

/** Every block in a document, children included. */
function everyBlock(blocks: BlockInstance[]): BlockInstance[] {
  return blocks.flatMap((b) => [b, ...everyBlock(childrenOf(b))]);
}

export const hasMarketingBlocks = (blocks: BlockInstance[]): boolean => everyBlock(blocks).some((b) => MARKETING_BLOCK_TYPES.has(b.type));
export const onlyMarketingBlocks = (blocks: BlockInstance[]): boolean => everyBlock(blocks).every((b) => MARKETING_BLOCK_TYPES.has(b.type));

const about = (i: number, type: BlockType, props: Record<string, unknown>): BlockInstance => ({ id: `about-${i}`, type, version: 1, props });

const home = (i: number, type: BlockType, props: Record<string, unknown>): BlockInstance => ({ id: `home-${i}`, type, version: 1, props });

/** What a new page with one of these handles starts from, so the code version does not have to be retyped. */
export const MARKETING_STARTERS: Record<string, BlockInstance[]> = {
  // The Home page. "home" is reserved as a page URL, so the website's Home page is stored under this slug and shown at "/".
  "bcom-home": [
    home(1, "MkHero", { stamp: "Ready today · AI agents coming soon", title: "The agent-first e-commerce platform for Indian brands.", lead: "A complete online store you can open today: cash on delivery, GST invoices, themes, orders and returns. Built from day one for the AI shopping era, so selling through ChatGPT, Gemini and Claude arrives as each one launches in India.", showNameChecker: true, fine: "14-day free trial · Cash on delivery and GST invoices included" }),
    home(2, "MkIncluded", { label: "Included on every plan", items: [{ icon: "check", label: "Cash on delivery" }, { icon: "check", label: "GST tax invoices" }, { icon: "check", label: "Visual theme builder" }, { icon: "check", label: "Returns and exchanges" }, { icon: "check", label: "Customers and segments" }] }),
    home(3, "MkStatement", { text: "Selling online usually means a website, a payment link, a GST spreadsheet and a chat group.", muted: "BCOM puts all of it in one place, then gets your store ready for the way people will shop next." }),
    home(4, "MkFeatures", { eyebrow: "Ready today", title: "A complete store, built for how India sells.", intro: "Open a store today and start taking orders. No waiting for new features.", tone: "soft", items: [
      { title: "Complete catalogue management", body: "Products, variants, categories, collections and stock. SEO is built in, with sitemaps and structured data." },
      { title: "Payments and invoices", body: "Accept UPI, cards and net banking, plus cash on delivery with a fee you set. Issue GST tax invoices." },
      { title: "Customers and segments", body: "Know who is buying, tag them, build segments and import or export your list." },
      { title: "Shipping, orders, returns and exchanges", body: "Set your shipping zones and rates, confirm and ship orders and handle returns and exchanges in one place." },
      { title: "Themes and visual theme builder", body: "Start from a theme made for your niche. Drag, drop and edit blocks. No code." },
    ] }),
    home(5, "MkSteps", { label: "How to open a store", items: [
      { icon: "globe", title: "Claim your name", body: "Pick a name and your store lives on yourname.bcom.si." },
      { icon: "tag", title: "Add your products", body: "Add products, variants, categories and stock." },
      { icon: "sparkles", title: "Make it yours", body: "Pick a theme made for your niche and edit blocks without code." },
      { icon: "check", title: "Take orders", body: "Set shipping rates and your COD fee, then share your store link." },
    ] }),
    home(6, "MkBand", { title: "Designed for the open standards behind AI commerce.", items: [{ name: "MCP", note: "Tools for assistants" }, { name: "UCP", note: "Google commerce" }, { name: "ACP", note: "OpenAI commerce" }, { name: "AP2", note: "Safe agent payments" }, { name: "A2A", note: "Agent to agent" }] }),
    home(7, "MkPricing", {}),
    home(8, "FaqSection", { eyebrow: "FAQ", title: "Straight answers.", description: "", items: [{ question: "Is there a free trial?", answer: "Yes. Every plan starts with a 14-day free trial and no card is needed to start." }] }),
    home(9, "MkFinalCall", { title: "Open your store today. Be ready for what comes next.", text: "14-day free trial. No card needed to start.", showPlansLink: true }),
  ],
  about: [
    about(1, "MkDocHeader", { eyebrow: "About us", title: "An e-commerce platform built for how India sells, and for how people will shop next.", intro: "" }),
    about(2, "MkDocSection", {
      heading: "Who we are",
      body: "BCOM (bcom.si) is a product of [Brand Sewa Digital Private Limited](https://brandsewa.com), a company registered in India. We build software that helps Indian brands open an online store and sell without needing a developer.",
      checks: [],
      after: "",
    }),
    about(3, "MkDocSection", {
      heading: "What BCOM does",
      body: "You pick a store name and get a complete online store on **yourname.bcom.si** with an admin to run it. Today that includes:",
      checks: [
        "a storefront with ready-made themes and a visual, no-code theme builder;",
        "products with variants, categories, collections and stock;",
        "online payments (UPI, cards and net banking) and cash on delivery, with GST tax invoices;",
        "orders, returns and exchanges;",
        "customers and segments, discounts, staff accounts and roles.",
      ],
      after: "Every plan starts with a 14-day free trial. See [pricing](/pricing) for plans in rupees.",
    }),
    about(4, "MkDocSection", {
      heading: "Why agent-first",
      body: "More people now ask AI assistants such as ChatGPT, Gemini and Claude what to buy. We are building BCOM so that stores on it are ready for that: products that assistants can read and compare, prices that stay locked and correct, and checkout that works as each assistant launches shopping in India. These features are marked **Coming soon** on our site until they are released, and stores on BCOM get them first.",
      checks: [],
      after: "",
    }),
    about(5, "MkValues", {
      heading: "How we work",
      items: [
        { icon: "sparkles", text: "We say what works today and mark what is coming." },
        { icon: "globe", text: "India first: rupees, GST, cash on delivery and the way Indian shoppers buy." },
        { icon: "lock", text: "Your store and your customers’ data stay yours." },
      ],
    }),
    about(6, "MkCompany", { heading: "The company", after: "Questions? [Contact us](/contact)." }),
    about(7, "MkFinalCall", { title: "Open your store today. Be ready for what comes next.", text: "14-day free trial. No card needed to start.", showPlansLink: true }),
  ],
};
