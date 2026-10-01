import React from "react";
import Link from "next/link";
import { renderBlockTree, type BlockInstance } from "@bs/blocks";
import "@bs/blocks/blocks.css";
import type { BlockRenderData } from "@/components/blocks/BlockRenderer.tsx";
import { CartBadge } from "./CartBadge.tsx";

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
        renderCart: () => <CartBadge />,
      })}
    </>
  );
}
