/**
 * Plain text to the validated block format a long description is stored in (headings, paragraphs, lists, dividers; never HTML,
 * ADR-010), and back. Used where text comes in from a spreadsheet or an old plain-text description and must become formatted
 * content. Pure and dependency free, so the admin and the domain share one implementation.
 *
 * Reading rules, line by line:
 *   `# Title`, `## Title`, `### Title`   a heading (level 2; `###` is level 3; a lone `#` is also level 2)
 *   `- item`, `* item`, `• item`         an unordered list item (consecutive lines form one list)
 *   `1. item`, `2) item`                 an ordered list item
 *   `---`                                a divider
 *   anything else                        paragraph text; a blank line ends the paragraph, single line breaks join with a space
 * Text longer than the limits is cut into several paragraphs rather than refused.
 */
export type TextBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; style: "ordered" | "unordered"; items: string[] }
  | { type: "divider" };

const MAX_PARAGRAPH = 2000;
const MAX_HEADING = 300;
const MAX_ITEM = 500;
const MAX_BLOCKS = 80;

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Splits long text at a space near the limit so no paragraph is lost to the 2,000 character cap. */
function paragraphsOf(text: string): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > MAX_PARAGRAPH) {
    const cut = rest.lastIndexOf(" ", MAX_PARAGRAPH);
    const at = cut > MAX_PARAGRAPH * 0.6 ? cut : MAX_PARAGRAPH;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function textToRichBlocks(input: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let para: string[] = [];
  let list: { style: "ordered" | "unordered"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length === 0) return;
    for (const p of paragraphsOf(para.join(" ").replace(/\s+/g, " "))) blocks.push({ type: "paragraph", text: p });
    para = [];
  };
  const flushList = () => {
    if (list && list.items.length > 0) blocks.push({ type: "list", style: list.style, items: list.items.slice(0, 50) });
    list = null;
  };

  for (const raw of input.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const unordered = /^(?:[-*•])\s+(.+)$/.exec(line);
    const ordered = /^\d{1,3}[.)]\s+(.+)$/.exec(line);
    if (/^-{3,}$/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ type: "divider" });
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: "heading", level: heading[1] === "###" ? 3 : 2, text: clip((heading[2] ?? "").trim(), MAX_HEADING) });
    } else if (unordered || ordered) {
      flushPara();
      const style = unordered ? "unordered" : "ordered";
      if (list && list.style !== style) flushList();
      list ??= { style, items: [] };
      list.items.push(clip(((unordered ?? ordered)?.[1] ?? "").trim(), MAX_ITEM));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks.slice(0, MAX_BLOCKS);
}

/** True when the text uses structure (a heading, list, divider or more than one paragraph), so it is worth storing as blocks. */
export function textHasStructure(input: string): boolean {
  const blocks = textToRichBlocks(input);
  return blocks.length > 1 || blocks.some((b) => b.type !== "paragraph");
}

/** The readable text of blocks (one line per block; list items one per line), for search snippets and plain-text uses. */
export function richBlocksToText(blocks: readonly { type: string; text?: string; items?: readonly string[] }[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if ((b.type === "heading" || b.type === "paragraph") && typeof b.text === "string") lines.push(b.text);
    else if (b.type === "list" && Array.isArray(b.items)) lines.push(...b.items);
  }
  return lines.join("\n");
}

/**
 * Blocks as text in the same shape `textToRichBlocks` reads, so a spreadsheet export can be edited and imported back without
 * losing the headings, lists and paragraphs (bold, italic and links are not carried in plain text).
 */
export function richBlocksToImportText(blocks: readonly { type: string; text?: string; level?: number; style?: string; items?: readonly string[] }[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "heading" && typeof b.text === "string") out.push(`${b.level === 3 ? "###" : "##"} ${b.text}`);
    else if (b.type === "paragraph" && typeof b.text === "string") out.push(b.text);
    else if (b.type === "list" && Array.isArray(b.items)) out.push(b.items.map((item, i) => (b.style === "ordered" ? `${i + 1}. ${item}` : `- ${item}`)).join("\n"));
    else if (b.type === "divider") out.push("---");
  }
  return out.join("\n\n");
}
