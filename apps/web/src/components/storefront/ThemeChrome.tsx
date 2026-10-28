import React from "react";
import Link from "next/link";
import { renderBlockTree, type BlockInstance } from "@bs/blocks";
import "@bs/blocks/blocks.css";
import type { BlockRenderData } from "@/components/blocks/BlockRenderer.tsx";
import { CartBadge } from "./CartBadge.tsx";
import { AccountLink } from "./AccountLink.tsx";
import { BannerClient } from "@/components/blocks/BannerClient.tsx";

/**
 * The store header or footer drawn from the theme's blocks. Navigation uses next/link (client
 * transitions and prefetch) and the cart keeps its live count. Rendered without a wrapper so a
 * sticky header sticks against the page, not against its own box.
 */
export function ThemeChrome({
  blocks,
  renderData,
  storeName,
  logoUrl,
}: {
  blocks: BlockInstance[];
  renderData?: BlockRenderData | undefined;
  storeName: string;
  logoUrl?: string | null | undefined;
}) {
  const media = renderData?.media ?? {};
  return (
    <>
      {renderBlockTree(blocks, {
        data: renderData?.data,
        mediaUrl: (id) => media[id] ?? null,
        storeName,
        logoUrl: logoUrl ?? null,
        renderLink: ({ href, className, children }) => (
          <Link href={href} {...(className ? { className } : {})}>
            {children}
          </Link>
        ),
        // From 1024px the cart is docked on the screen's right edge (layout.tsx), so the header drops it.
        renderCart: () => (
          <span className="lg:hidden">
            <CartBadge />
          </span>
        ),
        renderAccount: () => (
          <AccountLink
            icon={
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
            }
          />
        ),
        // The announcement bar's previous / next arrows.
        renderBanner: ({ children }) => <BannerClient>{children}</BannerClient>,
      })}
    </>
  );
}
