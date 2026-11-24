import { richBlocksToText, textHasStructure, textToRichBlocks } from "@bs/contracts/rich-text";
import { validatePolicyContent, type PolicyBlock } from "./policies/validator.ts";

/** The stored long description of a category or collection. */
export interface RichDescriptionValue {
  v: 1;
  blocks: PolicyBlock[];
}

/**
 * The long, formatted description of a category or collection. It is stored as the same validated block content the
 * policy editor writes (headings, paragraphs with bold, italic and https links, lists, dividers), never as HTML (ADR-010).
 * Empty content is stored as null.
 */
export function cleanRichDescription(input: unknown): Record<string, unknown> | null {
  if (input === null || input === undefined) return null;
  const blocks = (input as { blocks?: unknown }).blocks;
  if (Array.isArray(blocks) && blocks.length === 0) return null;
  const result = validatePolicyContent(input);
  if (!result.valid) throw new Error(`Bad Request: invalid description - ${result.error}`);
  return result.data as unknown as Record<string, unknown>;
}

/**
 * A product's long description as it is stored. Two forms exist: formatted blocks (`{ v: 1, blocks }`, the same validated content as
 * categories, collections and policies) and the older plain text (`{ type: "text", text }`). Blocks are validated; text is kept
 * as text unless it uses structure (a heading, list or several paragraphs), in which case it becomes blocks so a spreadsheet
 * import with paragraphs keeps them. Empty content is stored as null.
 */
export function normalizeProductDescription(input: unknown): Record<string, unknown> | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "object" && "blocks" in (input as object)) return cleanRichDescription(input);
  const text = typeof input === "string" ? input : typeof (input as { text?: unknown })?.text === "string" ? (input as { text: string }).text : null;
  if (text === null) throw new Error("Bad Request: invalid description");
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!textHasStructure(trimmed)) return { type: "text", text: trimmed };
  try {
    return cleanRichDescription({ v: 1, blocks: textToRichBlocks(trimmed) });
  } catch {
    return { type: "text", text: trimmed };
  }
}

/** The readable text of a stored long description of either form; "" when there is none. */
export function plainTextOfDescription(json: unknown): string {
  if (typeof json === "string") return json.trim();
  if (json && typeof json === "object") {
    const o = json as { text?: unknown; blocks?: unknown };
    if (typeof o.text === "string") return o.text.trim();
    if (Array.isArray(o.blocks)) return richBlocksToText(o.blocks as Array<{ type: string; text?: string; items?: string[] }>);
  }
  return "";
}

