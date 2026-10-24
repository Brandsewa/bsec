import { sanitizeRichText } from "./sanitize.ts";

/**
 * Parses markdown formatting (bold, italic, links, bullet lists, numbered lists)
 * into safe HTML sanitized via sanitizeRichText per ADR-009 / ADR-010.
 */
export function parseMarkdownToHtml(markdown: string): string {
  if (!markdown || typeof markdown !== "string") return "";

  // Normalize newlines
  const text = markdown.replace(/\r\n/g, "\n");

  // Inline formatting helper
  const formatInline = (str: string): string => {
    return str
      // Bold: **text** or __text__
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      // Italic: *text* or _text_
      .replace(/(^|[^*])\*(?!\*)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/(^|[^_])_(?!_)([^_]+?)_(?!_)/g, "$1<em>$2</em>")
      // Links: [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  };

  // Split into blocks by double newlines
  const rawBlocks = text.split(/\n{2,}/);
  const htmlBlocks: string[] = [];

  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split("\n");

    let inList: "ul" | "ol" | null = null;
    let listItems: string[] = [];
    let paraLines: string[] = [];

    const flushList = () => {
      if (inList && listItems.length > 0) {
        htmlBlocks.push(`<${inList}>${listItems.join("")}</${inList}>`);
        inList = null;
        listItems = [];
      }
    };

    const flushPara = () => {
      if (paraLines.length > 0) {
        htmlBlocks.push(`<p>${formatInline(paraLines.join("<br />"))}</p>`);
        paraLines = [];
      }
    };

    for (const line of lines) {
      const ulMatch = line.match(/^\s*[-*]\s+(.*)$/);
      const olMatch = line.match(/^\s*\d+\.\s+(.*)$/);

      if (ulMatch) {
        flushPara();
        if (inList !== "ul") {
          flushList();
          inList = "ul";
        }
        listItems.push(`<li>${formatInline(ulMatch[1] ?? "")}</li>`);
      } else if (olMatch) {
        flushPara();
        if (inList !== "ol") {
          flushList();
          inList = "ol";
        }
        listItems.push(`<li>${formatInline(olMatch[1] ?? "")}</li>`);
      } else {
        flushList();
        paraLines.push(line);
      }
    }

    flushPara();
    flushList();
  }

  return sanitizeRichText(htmlBlocks.join(""));
}
