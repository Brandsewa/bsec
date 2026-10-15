/**
 * HTML rich text sanitizer for block content using sanitize-html parser.
 * Enforces strict whitelist of safe formatting tags and attributes per ADR-009 / PLAN §2.
 */
import sanitizeHtml from "sanitize-html";
import { isUuid } from "./media.ts";

const ALLOWED_TAGS = [
  "p",
  "b",
  "i",
  "strong",
  "em",
  "u",
  "s",
  "strike",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "br",
  "hr",
  "a",
  "span",
  "div",
  "img",
];

const ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"];

/**
 * Sanitizes rich text HTML by removing dangerous tags, malicious attributes,
 * inline scripts, and unsafe URLs using a real parser-based pipeline.
 */
export function sanitizeRichText(html: string): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title", "target", "rel", "class", "id"],
      img: ["src", "alt", "title", "width", "height", "class", "id"],
      span: ["class", "id"],
      div: ["class", "id"],
      p: ["class", "id"],
      h1: ["class", "id"],
      h2: ["class", "id"],
      h3: ["class", "id"],
      h4: ["class", "id"],
      h5: ["class", "id"],
      h6: ["class", "id"],
      ul: ["class", "id"],
      ol: ["class", "id"],
      li: ["class", "id"],
      blockquote: ["class", "id"],
      code: ["class", "id"],
      pre: ["class", "id"],
    },
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: {
      a: ALLOWED_SCHEMES,
      img: ["http", "https", "data"],
    },
    allowProtocolRelative: true,
    transformTags: {
      a: (tagName, attribs) => {
        // Enforce rel="noopener noreferrer" when opening in new tab or external
        if (attribs.target === "_blank") {
          return {
            tagName,
            attribs: {
              ...attribs,
              rel: "noopener noreferrer",
            },
          };
        }
        return { tagName, attribs };
      },
    },
  });
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Drops invalid UUID strings for media reference properties.
 */
export function sanitizeMediaUuid(id: unknown): string | undefined {
  if (typeof id !== "string") return undefined;
  const trimmed = id.trim();
  return UUID_REGEX.test(trimmed) ? trimmed : undefined;
}


const BLOG_TAGS = [
  "p", "b", "i", "strong", "em", "u", "s", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "code", "pre", "br", "hr", "a", "figure", "figcaption", "img",
];

/**
 * Sanitiser profile for blog post bodies (ADR-033). Stricter than `sanitizeRichText`: no classes, ids, inline style,
 * iframes or h1 (the post title is the only h1; a pasted h1 becomes h2). Images survive only when they carry a valid
 * `data-media-id` that the caller resolved to a URL on our own media host (`imageSrc`); the submitted `src` is ignored.
 * External links get `rel="noopener nofollow"`.
 */
export function sanitizeBlogHtml(html: string, imageSrc: ReadonlyMap<string, { src: string; width?: number | null; height?: number | null }>): string {
  if (!html || typeof html !== "string") return "";
  return sanitizeHtml(html, {
    allowedTags: BLOG_TAGS.concat("h1"),
    allowedAttributes: {
      a: ["href", "title", "rel"],
      img: ["src", "alt", "width", "height", "loading", "data-media-id"],
    },
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    transformTags: {
      h1: "h2",
      a: (tagName, attribs) => {
        const href = attribs.href ?? "";
        const external = /^https?:\/\//i.test(href);
        const out: Record<string, string> = {};
        if (href) out.href = href;
        if (attribs.title) out.title = attribs.title;
        if (external) out.rel = "noopener nofollow";
        return { tagName, attribs: out };
      },
      img: (tagName, attribs) => {
        const raw = attribs["data-media-id"];
        const id = isUuid(raw) ? raw.trim().toLowerCase() : undefined;
        const hit = id ? imageSrc.get(id) : undefined;
        if (!id || !hit) return { tagName: "img", attribs: { "data-drop": "1" } };
        const out: Record<string, string> = { src: hit.src, "data-media-id": id, loading: "lazy", alt: (attribs.alt ?? "").slice(0, 300) };
        if (hit.width) out.width = String(hit.width);
        if (hit.height) out.height = String(hit.height);
        return { tagName, attribs: out };
      },
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  });
}
