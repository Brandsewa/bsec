import type { ReactNode } from "react";
import { renderBlockTree, type BlockData, type BlockInstance, type RenderContext } from "@bs/blocks";
import { generateFaqJsonLd } from "@bs/domain";
import "@bs/blocks/blocks.css";

export interface BlockRenderData {
  data: Record<string, BlockData>;
  media: Record<string, string>;
}

export interface BlockRendererProps {
  blocks: BlockInstance[];
  /** Store data and media URLs resolved on the server (see resolvePageRenderData). */
  renderData?: BlockRenderData | undefined;
}

export function BlockRenderer({ blocks, renderData }: BlockRendererProps) {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  const media = renderData?.media ?? {};
  const base: RenderContext = {
    data: renderData?.data,
    mediaUrl: (id) => media[id] ?? null,
  };

  return (
    <div className="storefront-blocks flex flex-col w-full">
      {renderBlockTree(blocks, base, {
        // FAQ blocks also emit Schema.org FAQPage JSON-LD
        wrap: (block, rendered, props): ReactNode => {
          const items = block.type === "FAQ" ? (props as { items?: Array<{ question: string; answer: string }> }).items : undefined;
          if (!items || items.length === 0) return rendered;
          return (
            <>
              <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(generateFaqJsonLd(items)) }} />
              {rendered}
            </>
          );
        },
      })}
    </div>
  );
}
