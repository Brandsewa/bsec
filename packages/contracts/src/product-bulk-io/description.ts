/**
 * Turns an imported description (plain text, light Markdown or HTML from Shopify/Woo) into the plain text a product
 * stores as `{ type: "text", text }`. Markup is never stored (ADR-010): scripts, styles and attributes are dropped.
 * Description and short description are plain text (owner decision 2026-10-31): paragraph breaks and `- ` list lines
 * survive, bold, italic and heading markup is dropped. Rich formatting is kept only for rich_text custom fields,
 * through `toRichTextHtml` (the custom-field sanitiser then cleans it).
 */

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

const decode = (s: string): string =>
  s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)));

export function importDescriptionToText(raw: string): string {
  let s = raw.replace(/\r\n?/g, "\n");
  if (/<[a-z][\s\S]*>/i.test(s)) {
    s = s
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, _l: string, t: string) => `\n\n${t.replace(/<[^>]+>/g, "").trim()}\n\n`)
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(ul|ol)>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr)>/gi, "\n\n")
      .replace(/<[^>]+>/g, "");
    s = decode(s);
  }
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Cell text for a rich_text custom field. HTML passes through untouched (the field sanitiser allow-lists tags);
 * plain text becomes paragraphs and bullet lists, with `**bold**` and `*italic*` Markdown honoured.
 */
export function toRichTextHtml(raw: string): string {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  const inline = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => /^[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`;
      const heading = lines.length === 1 ? lines[0]?.match(/^#{1,6} (.+)$/) : null;
      if (heading?.[1]) return `<h3>${inline(heading[1])}</h3>`;
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}
