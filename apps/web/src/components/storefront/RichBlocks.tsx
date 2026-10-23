import React from "react";
import type { PolicyBlock } from "@bs/domain";

type Mark = { type: "bold" | "italic" | "link"; start: number; end: number; href?: string | undefined };

/** Paragraph text with its bold, italic and link ranges applied (ranges may overlap). */
function Marked({ text, marks }: { text: string; marks: readonly Mark[] | undefined }) {
  if (!marks || marks.length === 0) return <>{text}</>;
  const cuts = [...new Set([0, text.length, ...marks.flatMap((m) => [m.start, m.end])])].filter((n) => n >= 0 && n <= text.length).sort((a, b) => a - b);
  const parts: React.ReactNode[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i] as number;
    const to = cuts[i + 1] as number;
    if (to <= from) continue;
    let node: React.ReactNode = text.slice(from, to);
    for (const m of marks) {
      if (m.start > from || m.end < to) continue;
      if (m.type === "bold") node = <strong>{node}</strong>;
      else if (m.type === "italic") node = <em>{node}</em>;
      else if (m.type === "link" && m.href) {
        node = (
          <a href={m.href} className="underline underline-offset-2" rel="noopener noreferrer">
            {node}
          </a>
        );
      }
    }
    parts.push(<React.Fragment key={from}>{node}</React.Fragment>);
  }
  return <>{parts}</>;
}

/**
 * Renders validated block content (policies, category and collection long descriptions). Only the four block types
 * exist, so there is no raw HTML to inject (ADR-010).
 */
export function RichBlocks({ blocks }: { blocks: readonly PolicyBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return block.level === 3 ? (
            <h3 key={index} className="mb-3 mt-6 text-xl font-semibold text-foreground">
              {block.text}
            </h3>
          ) : (
            <h2 key={index} className="mb-4 mt-8 text-2xl font-bold text-foreground">
              {block.text}
            </h2>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={index} className="my-4 leading-relaxed text-foreground/90">
              <Marked text={block.text} marks={block.marks} />
            </p>
          );
        }
        if (block.type === "list") {
          const Tag = block.style === "ordered" ? "ol" : "ul";
          return (
            <Tag key={index} className={`my-4 space-y-2 pl-6 text-foreground/90 ${block.style === "ordered" ? "list-decimal" : "list-disc"}`}>
              {block.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </Tag>
          );
        }
        return <hr key={index} className="my-8 border-border" />;
      })}
    </>
  );
}
