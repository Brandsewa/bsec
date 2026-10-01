import type { BlockEditorHost, MediaAsset } from "@bs/block-editor/preview";
import { computeThemeTokens } from "@bs/blocks";
import type { BrandSettings, Theme } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";

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
    const presigned = await client.admin.media.requestUpload({
      filename: file.name,
      mime: file.type,
      bytes: file.size,
      folder: "pages",
    });
    const put = await fetch(presigned.uploadUrl, { method: "PUT", headers: presigned.headers, body: file });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);
    const created = await client.admin.media.create({
      storageKey: presigned.storageKey,
      mime: file.type,
      bytes: file.size,
      alt: file.name,
      folder: "pages",
    });
    return { id: created.id, url: created.url ?? URL.createObjectURL(file), alt: created.alt ?? null };
  },
};

/** --bs-* CSS variables for the store's current branding, so previews match the storefront. */
export function themeVarsFor(brand: BrandSettings | undefined, theme: Theme | undefined): Record<string, string> {
  return computeThemeTokens(brand ?? null, (theme?.tokens ?? null) as never);
}
