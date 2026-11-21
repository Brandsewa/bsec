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

  async listCollections() {
    try {
      const res = await client.admin.collections.list();
      return res.filter((c) => c.published).map((c) => ({ slug: c.slug, title: c.title }));
    } catch {
      return [];
    }
  },

  async listProducts() {
    try {
      const res = await client.admin.products.list({ sort: "title_asc", limit: 100, offset: 0 });
      return res.items.map((p) => ({ slug: p.slug, title: p.title }));
    } catch {
      return [];
    }
  },

  async listCategories() {
    try {
      const res = await client.admin.categories.list();
      return res.filter((c) => c.isActive).map((c) => ({ slug: c.slug, title: c.name }));
    } catch {
      return [];
    }
  },
};

/** --bs-* CSS variables for the store's current branding, so previews match the storefront. */
export function themeVarsFor(brand: BrandSettings | undefined, theme: Theme | undefined): Record<string, string> {
  return resolveThemeTokens(brand ?? null, (theme?.tokens ?? null) as never);
}
