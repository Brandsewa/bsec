/**
 * HTML rich text sanitizer for block content using sanitize-html parser.
 * Enforces strict whitelist of safe formatting tags and attributes per ADR-009 / PLAN §2.
 */
import sanitizeHtml from "sanitize-html";

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
