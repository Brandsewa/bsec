import { createContext, useContext } from "react";
import type { BlockData } from "@bs/blocks";

export type MediaKind = "image" | "video" | "document";

/** What the editor needs from its host app (admin or super admin). Keeps this package app-agnostic. */
export interface MediaAsset {
  id: string;
  url: string;
  alt?: string | null | undefined;
  kind?: MediaKind | undefined;
  filename?: string | null | undefined;
  mime?: string | undefined;
  thumbnailUrl?: string | null | undefined;
}

export interface BlockEditorHost {
  /** Store data + media URLs for the blocks currently on the canvas (products, collections, images). */
  loadRenderData(blocks: unknown[]): Promise<{ data: Record<string, unknown>; media: Record<string, string> }>;
  /** Shared media library picker. Opens the host app's media picker dialog. */
  pickMedia?: ((opts: {
    accept: ("image" | "video" | "document")[];
    multiple?: boolean | undefined;
    max?: number | undefined;
    selected?: string[] | undefined;
  }) => Promise<MediaAsset[]>) | undefined;
  /** @deprecated Use pickMedia. Kept for backwards compatibility. */
  listMedia?: (() => Promise<MediaAsset[]>) | undefined;
  /** @deprecated Use pickMedia. Kept for backwards compatibility. */
  uploadMedia?: ((file: File) => Promise<MediaAsset>) | undefined;
  /** Available navigation menus for header/footer menu selection. */
  listMenus?: (() => Promise<Array<{ handle: string; title: string }>>) | undefined;
}

export interface EditorRenderData {
  data: Record<string, BlockData>;
  media: Record<string, string>;
  /** Shown in the header and footer blocks. */
  storeName?: string | undefined;
}

export const HostContext = createContext<BlockEditorHost | null>(null);
export const RenderDataContext = createContext<EditorRenderData>({ data: {}, media: {} });

export const useHost = () => useContext(HostContext);
export const useRenderData = () => useContext(RenderDataContext);
