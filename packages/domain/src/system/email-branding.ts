/**
 * Email branding tokens (docs/NOTIFICATION-MANAGER-PLAN.md section 6c, ADR-010: validated data, never code).
 * Two layers use the same shape. The platform (BCom) layer styles everything we send to store admins and staff and sets the
 * fonts. A store styles its own customer emails with logo, colours and footer only: fonts always come from the platform.
 * Pure: no database, no network.
 */

export interface EmailFooterLink {
  label: string;
  url: string;
}

export interface EmailBrandingTokens {
  /** https URL of an uploaded image, or null for a text logo. */
  logoUrl: string | null;
  /** Page background behind the card. */
  background: string;
  /** The card the message sits on. */
  card: string;
  /** Header strip colour (the logo sits on it). */
  headerBackground: string;
  headerText: string;
  text: string;
  mutedText: string;
  /** Accent: rules and highlights. Buttons and links default to it. */
  accent: string;
  buttonBackground: string;
  buttonText: string;
  linkColor: string;
  /** Key into FONT_STACKS. Only the platform layer may change it. */
  fontFamily: FontKey;
  /** Body size in px (13 to 18). Only the platform layer may change it. */
  baseFontSize: number;
  /** Heading size = base size x scale (1.2 to 2). Only the platform layer may change it. */
  headingScale: number;
  footer: {
    text: string;
    address: string;
    supportEmail: string;
    links: EmailFooterLink[];
  };
}

export type FontKey = "system" | "georgia" | "trebuchet" | "verdana" | "tahoma" | "times";

/** Email-safe stacks. Web fonts do not load reliably in mail clients, so the list is closed. */
export const FONT_STACKS: Record<FontKey, string> = {
  system: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  georgia: "Georgia,'Times New Roman',Times,serif",
  trebuchet: "'Trebuchet MS',Helvetica,Arial,sans-serif",
  verdana: "Verdana,Geneva,sans-serif",
  tahoma: "Tahoma,Geneva,sans-serif",
  times: "'Times New Roman',Times,serif",
};

export const DEFAULT_EMAIL_BRANDING: EmailBrandingTokens = {
  logoUrl: null,
  background: "#f4f5f4",
  card: "#ffffff",
  headerBackground: "#ffffff",
  headerText: "#1c1f1d",
  text: "#1c1f1d",
  mutedText: "#6b726e",
  accent: "#1f6f4a",
  buttonBackground: "#1f6f4a",
  buttonText: "#ffffff",
  linkColor: "#1f6f4a",
  fontFamily: "system",
  baseFontSize: 15,
  headingScale: 1.5,
  footer: { text: "", address: "", supportEmail: "", links: [] },
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normaliseHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!HEX.test(v)) return null;
  if (v.length === 4) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  return v.toLowerCase();
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on the colour. Used when a pair would be unreadable. */
export function readableOn(background: string): string {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#111111") ? "#ffffff" : "#111111";
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Plain text only: tags and control characters are dropped, the renderer escapes the rest.
  let out = "";
  for (const ch of value.replace(/<[^>]*>/g, "")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 || code === 9 || code === 10 || code === 13) out += ch;
  }
  return out.trim().slice(0, max);
}

function cleanHttpsUrl(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || v.length > max) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface BrandingIssue {
  field: string;
  message: string;
}

export interface ParseBrandingOptions {
  /** A store may not change fonts: its font fields are ignored and the platform's values are kept. */
  layer: "platform" | "store";
  /** The platform tokens a store layer inherits fonts from. */
  platform?: EmailBrandingTokens | undefined;
}

/**
 * Validates tokens. Unknown or invalid values fall back to `base` (never throws), so a bad stored row cannot break
 * mail. `issues` lists what was rejected so the editors can tell the user.
 */
export function parseEmailBranding(
  raw: unknown,
  base: EmailBrandingTokens = DEFAULT_EMAIL_BRANDING,
  opts: ParseBrandingOptions = { layer: "platform" },
): { tokens: EmailBrandingTokens; issues: BrandingIssue[] } {
  const issues: BrandingIssue[] = [];
  const obj = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: EmailBrandingTokens = { ...base, footer: { ...base.footer, links: [...base.footer.links] } };

  const colourKeys = ["background", "card", "headerBackground", "headerText", "text", "mutedText", "accent", "buttonBackground", "buttonText", "linkColor"] as const;
  for (const key of colourKeys) {
    if (obj[key] === undefined) continue;
    const hex = normaliseHex(obj[key]);
    if (hex) out[key] = hex;
    else issues.push({ field: key, message: "Use a hex colour such as #1f6f4a." });
  }
  // Buttons and links follow the accent unless set explicitly.
  if (obj.buttonBackground === undefined && obj.accent !== undefined) out.buttonBackground = out.accent;
  if (obj.linkColor === undefined && obj.accent !== undefined) out.linkColor = out.accent;

  if (obj.logoUrl !== undefined) {
    if (obj.logoUrl === null || obj.logoUrl === "") out.logoUrl = null;
    else {
      const url = cleanHttpsUrl(obj.logoUrl);
      if (url) out.logoUrl = url;
      else issues.push({ field: "logoUrl", message: "The logo must be an uploaded image served over https." });
    }
  }

  if (opts.layer === "platform") {
    if (obj.fontFamily !== undefined) {
      if (typeof obj.fontFamily === "string" && obj.fontFamily in FONT_STACKS) out.fontFamily = obj.fontFamily as FontKey;
      else issues.push({ field: "fontFamily", message: "Choose one of the listed email-safe fonts." });
    }
    if (obj.baseFontSize !== undefined) {
      const n = Number(obj.baseFontSize);
      if (Number.isFinite(n) && n >= 13 && n <= 18) out.baseFontSize = Math.round(n);
      else issues.push({ field: "baseFontSize", message: "Base size must be between 13 and 18 px." });
    }
    if (obj.headingScale !== undefined) {
      const n = Number(obj.headingScale);
      if (Number.isFinite(n) && n >= 1.2 && n <= 2) out.headingScale = Math.round(n * 100) / 100;
      else issues.push({ field: "headingScale", message: "Heading scale must be between 1.2 and 2." });
    }
  } else if (opts.platform) {
    out.fontFamily = opts.platform.fontFamily;
    out.baseFontSize = opts.platform.baseFontSize;
    out.headingScale = opts.platform.headingScale;
  }

  if (obj.footer && typeof obj.footer === "object" && !Array.isArray(obj.footer)) {
    const f = obj.footer as Record<string, unknown>;
    if (f.text !== undefined) out.footer.text = cleanText(f.text, 300);
    if (f.address !== undefined) out.footer.address = cleanText(f.address, 200);
    if (f.supportEmail !== undefined) {
      const e = typeof f.supportEmail === "string" ? f.supportEmail.trim().toLowerCase() : "";
      if (e === "") out.footer.supportEmail = "";
      else if (EMAIL.test(e)) out.footer.supportEmail = e;
      else issues.push({ field: "footer.supportEmail", message: "Enter a valid email address." });
    }
    if (Array.isArray(f.links)) {
      const links: EmailFooterLink[] = [];
      for (const item of f.links.slice(0, 4)) {
        const l = (item ?? {}) as Record<string, unknown>;
        const label = cleanText(l.label, 40);
        const url = cleanHttpsUrl(l.url);
        if (label && url) links.push({ label, url });
        else issues.push({ field: "footer.links", message: "Each footer link needs a label and an https address." });
      }
      out.footer.links = links;
    }
  }

  // Unreadable pairs never leave this function: the text colour is replaced and the editor is told.
  const pairs: Array<[keyof EmailBrandingTokens, keyof EmailBrandingTokens, number]> = [
    ["buttonText", "buttonBackground", 4.5],
    ["text", "card", 4.5],
    ["headerText", "headerBackground", 4.5],
  ];
  for (const [fg, bg, min] of pairs) {
    const a = out[fg] as string;
    const b = out[bg] as string;
    if (contrastRatio(a, b) < min) {
      issues.push({ field: String(fg), message: `Too little contrast against ${String(bg)}; a readable colour is used instead.` });
      (out[fg] as string) = readableOn(b);
    }
  }
  if (contrastRatio(out.linkColor, out.card) < 3) {
    issues.push({ field: "linkColor", message: "Link colour is hard to see on the card; a readable colour is used instead." });
    out.linkColor = readableOn(out.card) === "#ffffff" ? "#9bd0ff" : "#0b57d0";
  }
  return { tokens: out, issues };
}

/** The final tokens for one send: platform tokens, plus a store's customer-email overrides when the audience is a customer. */
export function resolveEmailBranding(platformRaw: unknown, storeRaw?: unknown): EmailBrandingTokens {
  const platform = parseEmailBranding(platformRaw, DEFAULT_EMAIL_BRANDING, { layer: "platform" }).tokens;
  if (storeRaw === undefined || storeRaw === null) return platform;
  return parseEmailBranding(storeRaw, platform, { layer: "store", platform }).tokens;
}
