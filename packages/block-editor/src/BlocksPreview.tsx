import { useEffect, useState, type CSSProperties } from "react";
import "@bs/blocks/blocks.css";
import { renderBlockTree, type BlockData, type BlockInstance } from "@bs/blocks";
import type { BlockEditorHost } from "./context.tsx";

export interface BlocksPreviewProps {
  blocks: BlockInstance[];
  host: Pick<BlockEditorHost, "loadRenderData">;
  themeVars?: Record<string, string> | undefined;
  /** Frame width in px (e.g. 375 for a phone); omit for full width. */
  width?: number | undefined;
}

/** Read-only render of a block tree with the store's real data, e.g. to preview a theme before activating it. */
export function BlocksPreview({ blocks, host, themeVars, width }: BlocksPreviewProps) {
  const [render, setRender] = useState<{ data: Record<string, BlockData>; media: Record<string, string> }>({ data: {}, media: {} });

  useEffect(() => {
    let cancelled = false;
    host
      .loadRenderData(blocks)
      .then((r) => {
        if (!cancelled) setRender(r as typeof render);
      })
      .catch(() => {
        /* previews degrade to empty states */
      });
    return () => {
      cancelled = true;
    };
  }, [blocks, host]);

  return (
    <div
      className="bsb"
      style={{ ...(themeVars as CSSProperties), background: "var(--bs-bg, #fff)", width: width ? `${width}px` : "100%", maxWidth: "100%", margin: "0 auto" }}
    >
      {renderBlockTree(blocks, { data: render.data, mediaUrl: (id) => render.media[id] ?? null })}
    </div>
  );
}
