import type { ReactNode } from "react";
import { renderBlockTree, type BlockData, type BlockInstance, type RenderContext } from "@bs/blocks";
import { generateFaqJsonLd } from "@bs/domain";
import { HeroSliderClient } from "./HeroSliderClient.tsx";
import { BannerClient } from "./BannerClient.tsx";
import { ProductShowcaseClient } from "./ProductShowcaseClient.tsx";
import { GalleryClient } from "./GalleryClient.tsx";
import { ContactFormLazy } from "./ContactFormLazy.tsx";
import "@bs/blocks/blocks.css";

export interface BlockRenderData {
  data: Record<string, BlockData>;
  media: Record<string, string>;
}

export interface BlockRendererProps {
  blocks: BlockInstance[];
  /** Store data and media URLs resolved on the server (see resolvePageRenderData). */
  renderData?: BlockRenderData | undefined;
  /** Extra render hooks (store name, links, cart, product/collection cores). */
  context?: Partial<RenderContext> | undefined;
}

export function BlockRenderer({ blocks, renderData, context }: BlockRendererProps) {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  const media = renderData?.media ?? {};
  const base: RenderContext = {
    // The hero slider's autoplay / arrows / dots (a small client component around the server-rendered slides).
    renderHeroSlider: ({ options, children }) => <HeroSliderClient options={options}>{children}</HeroSliderClient>,
    // The announcement bar's previous / next arrows.
    renderBanner: ({ children }) => <BannerClient>{children}</BannerClient>,
    // The product showcase's tabs / dots / arrows / quick add to cart.
    renderProductShowcase: ({ options, children }) => <ProductShowcaseClient options={options}>{children}</ProductShowcaseClient>,
    // The contact form (posts to the store inbox).
    renderContactForm: (options) => <ContactFormLazy options={options} />,
    // The gallery's click-to-open viewer.
    renderGallery: ({ images, children }) => <GalleryClient images={images}>{children}</GalleryClient>,
    ...context,
    data: renderData?.data,
    mediaUrl: (id) => media[id] ?? null,
  };

  return (
    <div className="storefront-blocks flex flex-col w-full">
      {renderBlockTree(blocks, base, {
        // FAQ accordion blocks also emit Schema.org FAQPage JSON-LD
        wrap: (block, rendered, props): ReactNode => {
          const items = block.type === "FaqSection" ? (props as { items?: Array<{ question: string; answer: string }> }).items : undefined;
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
