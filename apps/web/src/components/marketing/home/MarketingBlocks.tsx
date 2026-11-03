import { renderBlockDocument, renderBlockTree, type RenderContext } from "@bs/blocks";
import { mediaDetailsFor, type BlockRenderData } from "../../blocks/BlockRenderer.tsx";
import { BannerClient } from "../../blocks/BannerClient.tsx";
import { GalleryClient } from "../../blocks/GalleryClient.tsx";
import { CompanyBox } from "../landing/LegalBits.tsx";
import { SubdomainAvailabilityChecker } from "../SubdomainAvailabilityChecker.tsx";

/** Blocks that lay themselves out to the full page width. */
const OWN_WIDTH: ReadonlySet<string> = new Set(["Section", "Container", "Block", "ImageBanner", "Banner"]);

/** A website page built in Super Admin. Null when its document cannot be drawn, so the caller keeps the built-in version (ADR-011). */
export function marketingPageContent(document: unknown, renderData?: BlockRenderData) {
  const result = renderBlockDocument(document);
  if (!result.success || result.blocks.length === 0) return null;
  const media = renderData?.media ?? {};
  const ctx: RenderContext = {
    renderNameChecker: () => <SubdomainAvailabilityChecker platformDomain="bcom.si" />,
    renderCompany: () => <CompanyBox />,
    renderBanner: ({ children }) => <BannerClient>{children}</BannerClient>,
    renderGallery: ({ images, children }) => <GalleryClient images={images}>{children}</GalleryClient>,
    data: renderData?.data,
    mediaUrl: (id) => media[id] ?? null,
    mediaDetails: mediaDetailsFor(renderData),
  };
  // Website sections and layout blocks (Section, Container) set their own width; a bare heading, text or button
  // gets the site's page width, so it does not sit against the window edge.
  return result.blocks.map((block) => {
    const node = renderBlockTree([block], ctx);
    return OWN_WIDTH.has(block.type) || block.type.startsWith("Mk") ? node : (
      <div key={block.id} className="wrap" style={{ paddingBlock: "1rem" }}>{node}</div>
    );
  });
}
