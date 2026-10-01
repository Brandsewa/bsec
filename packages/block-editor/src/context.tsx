import { createContext, useContext } from "react";
import type { BlockData } from "@bs/blocks";

/** What the editor needs from its host app (admin or super admin). Keeps this package app-agnostic. */
export interface MediaAsset {
  id: string;
  url: string;
  alt?: string | null | undefined;
}

export interface BlockEditorHost {
  /** Store data + media URLs for the blocks currently on the canvas (products, collections, images). */
  loadRenderData(blocks: unknown[]): Promise<{ data: Record<string, unknown>; media: Record<string, string> }>;
  /** Media library. Omit for contexts without a store (platform theme templates). */
  listMedia?: (() => Promise<MediaAsset[]>) | undefined;
  uploadMedia?: ((file: File) => Promise<MediaAsset>) | undefined;
}

export interface EditorRenderData {
  data: Record<string, BlockData>;
  media: Record<string, string>;
}

export const HostContext = createContext<BlockEditorHost | null>(null);
export const RenderDataContext = createContext<EditorRenderData>({ data: {}, media: {} });

export const useHost = () => useContext(HostContext);
export const useRenderData = () => useContext(RenderDataContext);
