import type { StorefrontBrandAssets } from "@bs/domain";

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * A store's web app manifest from its name, Brand colours and icons. Only colours that are valid hex are used, and only icons the
 * merchant uploaded, with their real sizes: a manifest never advertises an icon we do not have.
 */
export function buildStoreWebManifest(input: {
  name: string;
  assets: Pick<StorefrontBrandAssets, "faviconUrl" | "faviconSizes" | "appleTouchIconUrl" | "appleTouchIconSizes"> | null | undefined;
  themeColor?: string | null | undefined;
  backgroundColor?: string | null | undefined;
}): Record<string, unknown> {
  const icons: Array<{ src: string; sizes: string; type?: string }> = [];
  const add = (src: string | null | undefined, sizes: string | null | undefined) => {
    if (!src || !sizes) return;
    const type = /\.png(\?|$)/i.test(src) ? "image/png" : /\.svg(\?|$)/i.test(src) ? "image/svg+xml" : /\.(jpe?g)(\?|$)/i.test(src) ? "image/jpeg" : undefined;
    icons.push({ src, sizes, ...(type ? { type } : {}) });
  };
  add(input.assets?.appleTouchIconUrl, input.assets?.appleTouchIconSizes);
  add(input.assets?.faviconUrl, input.assets?.faviconSizes);
  return {
    name: input.name,
    short_name: input.name.length > 12 ? input.name.slice(0, 12).trim() : input.name,
    start_url: "/",
    display: "browser",
    ...(input.themeColor && HEX.test(input.themeColor) ? { theme_color: input.themeColor } : {}),
    ...(input.backgroundColor && HEX.test(input.backgroundColor) ? { background_color: input.backgroundColor } : {}),
    ...(icons.length > 0 ? { icons } : {}),
  };
}
