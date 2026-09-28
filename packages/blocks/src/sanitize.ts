/**
 * Zero-dependency HTML rich text sanitizer for block content.
 * Enforces strict whitelist of safe formatting tags and attributes per ADR-009 / PLAN §2.
 */

const DANGEROUS_TAGS_REGEX = /<(script|style|iframe|object|embed)[\s\S]*?<\/\1>|<(script|style|iframe|object|embed)[^>]*\/?>/gi;

const ALLOWED_TAGS = new Set([
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
]);

const SAFE_URL_PATTERN = /^(https?:\/\/|\/|#|mailto:|tel:)/i;

/**
 * Parses tag attributes into key-value pairs safely.
 */
function parseAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_\-:]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(rawAttrs)) !== null) {
    const rawKey = match[1];
    if (!rawKey) continue;
    const key = rawKey.toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[key] = val;
  }

  return attrs;
}

/**
 * Sanitizes rich text HTML by removing dangerous tags, malicious attributes,
 * inline scripts, and unsafe URLs.
 */
export function sanitizeRichText(html: string): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  // 1. Remove dangerous blocks and tags completely
  let sanitized = html.replace(DANGEROUS_TAGS_REGEX, "");

  // 2. Process all remaining HTML tags
  const tagRegex = /<\s*(\/)?\s*([a-zA-Z0-9]+)([^>]*)>/g;

  sanitized = sanitized.replace(tagRegex, (_fullMatch, isClosing, rawTagName, rawAttrs) => {
    const tag = rawTagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      return "";
    }

    if (isClosing) {
      return `</${tag}>`;
    }

    const attrs = parseAttributes(rawAttrs);
    const safeAttrs: string[] = [];

    // Filter attributes
    for (const [key, val] of Object.entries(attrs)) {
      // Disallow inline event handlers (on*) and inline styles
      if (key.startsWith("on") || key === "style") {
        continue;
      }

      if (tag === "a") {
        if (key === "href") {
          const trimmed = val.trim();
          if (SAFE_URL_PATTERN.test(trimmed)) {
            safeAttrs.push(`href="${escapeAttr(trimmed)}"`);
          }
          continue;
        }
        if (key === "title") {
          safeAttrs.push(`title="${escapeAttr(val)}"`);
          continue;
        }
        if (key === "target") {
          if (val === "_blank" || val === "_self") {
            safeAttrs.push(`target="${escapeAttr(val)}"`);
          }
          continue;
        }
      } else if (tag === "img") {
        if (key === "src") {
          const trimmed = val.trim();
          if (SAFE_URL_PATTERN.test(trimmed)) {
            safeAttrs.push(`src="${escapeAttr(trimmed)}"`);
          }
          continue;
        }
        if (["alt", "title", "width", "height"].includes(key)) {
          safeAttrs.push(`${key}="${escapeAttr(val)}"`);
          continue;
        }
      } else if (["class", "id"].includes(key)) {
        // Safe styling classes
        safeAttrs.push(`${key}="${escapeAttr(val)}"`);
      }
    }

    // Auto-enforce rel="noopener noreferrer" for external links
    if (tag === "a") {
      const hasTargetBlank = safeAttrs.some((a) => a.includes('target="_blank"'));
      if (hasTargetBlank) {
        safeAttrs.push('rel="noopener noreferrer"');
      }
    }

    const attrString = safeAttrs.length > 0 ? " " + safeAttrs.join(" ") : "";
    const isSelfClosing = ["br", "hr", "img"].includes(tag);

    return isSelfClosing ? `<${tag}${attrString} />` : `<${tag}${attrString}>`;
  });

  return sanitized;
}

function escapeAttr(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
