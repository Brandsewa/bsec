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
