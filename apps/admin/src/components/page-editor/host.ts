import type { BlockEditorHost } from "@bs/block-editor/preview";
import { resolveThemeTokens } from "@bs/blocks";
import type { BrandSettings, Theme } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";

/** Connects the block editor/preview to the store admin API (same data the storefront will render). */
export const storeHost: BlockEditorHost = {
  loadRenderData: (blocks) => client.admin.pages.blockData({ blocks }),

  async listMenus() {
    try {
      const res = await client.admin.menus.list();
      return res.map((m) => ({ handle: m.handle, title: m.name }));
    } catch {
      return [];
    }
  },
};

/** --bs-* CSS variables for the store's current branding, so previews match the storefront. */
export function themeVarsFor(brand: BrandSettings | undefined, theme: Theme | undefined): Record<string, string> {
  return resolveThemeTokens(brand ?? null, (theme?.tokens ?? null) as never);
}
