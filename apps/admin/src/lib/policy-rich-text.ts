import type { PolicyBlock } from "@bs/contracts";

/**
 * Converts between the stored policy format (validated blocks, ADR-010) and the rich text editor's document.
 * The server format does not change: the editor is only a friendlier way to produce the same safe blocks.
 * What the stored format can hold: headings (2 and 3), paragraphs with bold, italic and https/mailto/tel links,
 * bulleted or numbered lists of plain text items, and dividers. Anything else is not offered by the editor.
 */

/** The small slice of a TipTap/ProseMirror JSON node this converter reads and writes. */
export interface RichNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: RichNode[];
}

type PolicyMark = { type: "bold" | "italic" | "link"; start: number; end: number; href?: string };
type ParagraphBlock = Extract<PolicyBlock, { type: "paragraph" }>;

const ALLOWED_LINK = /^(https:\/\/|mailto:|tel:)/i;

/** Makes a typed link address acceptable to the policy validator (https, mailto or tel only). Returns null if it cannot be. */
export function normalizePolicyHref(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (ALLOWED_LINK.test(url)) return url;
  if (/^http:\/\//i.test(url)) return url.replace(/^http:\/\//i, "https://");
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null; // some other scheme (javascript:, data:, ...)
  return `https://${url.replace(/^\/+/, "")}`;
}

function plainText(node: RichNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  return (node.content ?? []).map(plainText).join("");
}

/** Splits a paragraph's inline content at hard line breaks so each line becomes its own paragraph block. */
function splitOnBreaks(nodes: RichNode[]): RichNode[][] {
  const lines: RichNode[][] = [[]];
  for (const n of nodes) {
    if (n.type === "hardBreak") lines.push([]);
    else lines[lines.length - 1]?.push(n);
  }
  return lines;
}

function inlineToParagraph(nodes: RichNode[]): ParagraphBlock | null {
  let text = "";
  const marks: PolicyMark[] = [];
  for (const n of nodes) {
    if (n.type !== "text" || !n.text) continue;
    const start = text.length;
    text += n.text;
    const end = text.length;
    for (const m of n.marks ?? []) {
      let mark: PolicyMark | null = null;
      if (m.type === "bold" || m.type === "italic") mark = { type: m.type, start, end };
      else if (m.type === "link") {
        const href = normalizePolicyHref(String(m.attrs?.["href"] ?? ""));
        if (href) mark = { type: "link", start, end, href };
      }
      if (!mark) continue;
      const added = mark;
      // Merge with a run of the same mark that ends exactly where this one starts.
      const prev = marks.find((x) => x.type === added.type && x.href === added.href && x.end === start);
      if (prev) prev.end = end;
      else marks.push(added);
    }
  }
  if (text.trim() === "") return null;
  return marks.length > 0 ? { type: "paragraph", text, marks } : { type: "paragraph", text };
}

function listItems(list: RichNode): string[] {
  const items: string[] = [];
  const visit = (node: RichNode) => {
    if (node.type === "listItem") {
      // Nested lists are flattened: the stored format has one level.
      const own = (node.content ?? []).filter((c) => c.type !== "bulletList" && c.type !== "orderedList");
      const text = own.map(plainText).join(" ").replace(/\s+/g, " ").trim();
      if (text) items.push(text);
      for (const child of node.content ?? []) {
        if (child.type === "bulletList" || child.type === "orderedList") (child.content ?? []).forEach(visit);
      }
      return;
    }
    (node.content ?? []).forEach(visit);
  };
  (list.content ?? []).forEach(visit);
  return items;
}

/** Editor document to stored policy blocks. Empty paragraphs and unsupported nodes are dropped. */
export function docToPolicyBlocks(doc: RichNode): PolicyBlock[] {
  const blocks: PolicyBlock[] = [];
  for (const node of doc.content ?? []) {
    if (node.type === "heading") {
      const text = plainText(node).trim();
      if (text) blocks.push({ type: "heading", level: node.attrs?.["level"] === 3 ? 3 : 2, text });
    } else if (node.type === "paragraph") {
      for (const line of splitOnBreaks(node.content ?? [])) {
        const para = inlineToParagraph(line);
        if (para) blocks.push(para);
      }
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      const items = listItems(node);
      if (items.length > 0) blocks.push({ type: "list", style: node.type === "orderedList" ? "ordered" : "unordered", items });
    } else if (node.type === "horizontalRule") {
      blocks.push({ type: "divider" });
    }
  }
  return blocks;
}

function paragraphToNodes(block: ParagraphBlock): RichNode[] {
  const text = block.text;
  const marks = block.marks ?? [];
  const cuts = new Set<number>([0, text.length]);
  for (const m of marks) {
    cuts.add(Math.max(0, Math.min(m.start, text.length)));
    cuts.add(Math.max(0, Math.min(m.end, text.length)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const nodes: RichNode[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i] as number;
    const b = points[i + 1] as number;
    if (b <= a) continue;
    const active = marks.filter((m) => m.start <= a && m.end >= b);
    const node: RichNode = { type: "text", text: text.slice(a, b) };
    if (active.length > 0) {
      node.marks = active.map((m) => (m.type === "link" ? { type: "link", attrs: { href: m.href } } : { type: m.type }));
    }
    nodes.push(node);
  }
  return nodes;
}

/** Stored policy blocks to an editor document, so existing block-based policies open as normal rich text. */
export function policyBlocksToDoc(blocks: readonly PolicyBlock[]): RichNode {
  const content: RichNode[] = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      content.push({ type: "heading", attrs: { level: block.level }, content: [{ type: "text", text: block.text }] });
    } else if (block.type === "paragraph") {
      content.push({ type: "paragraph", content: paragraphToNodes(block) });
    } else if (block.type === "list") {
      content.push({
        type: block.style === "ordered" ? "orderedList" : "bulletList",
        content: block.items.map((item) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: item }] }] })),
      });
    } else if (block.type === "divider") {
      content.push({ type: "horizontalRule" });
    }
  }
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}
