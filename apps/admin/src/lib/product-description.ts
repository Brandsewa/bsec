import type { RichDescription } from "@bs/contracts";
import { textToRichBlocks } from "@bs/contracts/rich-text";

/**
 * What the product editor starts from: formatted blocks as they are stored, or an older plain-text description turned into
 * paragraphs (and headings or lists, if the text used them), so nothing written before is lost when the editor opens.
 */
export function initialProductDescription(json: unknown): RichDescription | null {
  if (json && typeof json === "object" && Array.isArray((json as { blocks?: unknown }).blocks)) {
    const blocks = (json as RichDescription).blocks;
    return blocks.length > 0 ? { v: 1, blocks } : null;
  }
  const text = typeof json === "string" ? json : json && typeof json === "object" && typeof (json as { text?: unknown }).text === "string" ? (json as { text: string }).text : "";
  if (!text.trim()) return null;
  const blocks = textToRichBlocks(text) as RichDescription["blocks"];
  return blocks.length > 0 ? { v: 1, blocks } : null;
}
