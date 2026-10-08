import type { BlockEditorHost, MediaAsset } from "@bs/block-editor/preview";
import { resolveThemeTokens } from "@bs/blocks";
import type { BrandSettings, Theme } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";
import { uploadMedia } from "../../lib/upload-media.ts";

/** Connects the block editor/preview to the store admin API (same data the storefront will render). */
export const storeHost: BlockEditorHost & {
  listMedia: () => Promise<MediaAsset[]>;
  uploadMedia: (file: File) => Promise<MediaAsset>;
} = {
  loadRenderData: (blocks) => client.admin.pages.blockData({ blocks }),

  async listMedia() {
    const res = await client.admin.media.list({ limit: 100, offset: 0 });
    return res.items
      .filter((m) => m.mime.startsWith("image/") && m.url)
      .map((m) => ({ id: m.id, url: m.url as string, alt: m.alt ?? null }));
  },

  async uploadMedia(file: File) {
    if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
    const created = await uploadMedia(file, { folder: "pages", alt: file.name });
    return { id: created.id, url: created.url ?? URL.createObjectURL(file), alt: created.alt ?? null };
  },
};

/** --bs-* CSS variables for the store's current branding, so previews match the storefront. */
export function themeVarsFor(brand: BrandSettings | undefined, theme: Theme | undefined): Record<string, string> {
  return resolveThemeTokens(brand ?? null, (theme?.tokens ?? null) as never);
}
