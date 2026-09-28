import React from "react";
import type { BlockInstance } from "@bs/blocks";
import { getBlockDefinition } from "@bs/blocks";
import { generateFaqJsonLd } from "@bs/domain";

export interface BlockRendererProps {
  blocks: BlockInstance[];
}

export function BlockRenderer({ blocks }: BlockRendererProps) {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  return (
    <div className="storefront-blocks flex flex-col w-full">
      {blocks.map((block) => {
        if (block.hidden) return null;

        let def;
        try {
          def = getBlockDefinition(block.type);
        } catch {
          return null;
        }

        // Parse/merge props with defaults
        const parsed = def.schema.safeParse(block.props);
        const effectiveProps = parsed.success
          ? parsed.data
          : { ...def.defaultProps, ...block.props };

        // For FAQ block, inject Schema.org FAQPage JSON-LD
        let faqSchemaScript: React.ReactNode = null;
        if (block.type === "FAQ") {
          const faqProps = effectiveProps as {
            items?: Array<{ question: string; answer: string }>;
          };
          if (faqProps.items && faqProps.items.length > 0) {
            const faqJsonLd = generateFaqJsonLd(faqProps.items);
            faqSchemaScript = (
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
              />
            );
          }
        }

        // Render registered block
        const rendered = (def.render as (data: { props: unknown }) => React.ReactNode)({ props: effectiveProps });

        return (
          <React.Fragment key={block.id}>
            {faqSchemaScript}
            {rendered}
          </React.Fragment>
        );
      })}
    </div>
  );
}
