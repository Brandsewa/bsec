/**
 * Favicon & Web Manifest generation utilities per PLAN §8.1.
 */

export const FAVICON_SIZES = [16, 32, 180, 192, 512] as const;
export type FaviconSize = (typeof FAVICON_SIZES)[number];

export interface WebManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

export interface WebManifest {
  name: string;
  short_name: string;
  icons: WebManifestIcon[];
  start_url: string;
  display: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  background_color?: string;
  theme_color?: string;
}

/**
 * Generates a standard W3C Web App Manifest referencing generated icon sizes.
 */
export function generateWebManifest(
  storeName: string,
  iconUrls: Record<number | string, string>,
  options: { backgroundColor?: string; themeColor?: string } = {},
): WebManifest {
  const icons: WebManifestIcon[] = [];

  for (const size of FAVICON_SIZES) {
    const url = iconUrls[size];
    if (url) {
      const isLargeIcon = size >= 192;
      icons.push({
        src: url,
        sizes: `${size}x${size}`,
        type: "image/png",
        ...(isLargeIcon ? { purpose: "any maskable" } : {}),
      });
    }
  }

  return {
    name: storeName,
    short_name: storeName,
    icons,
    start_url: "/",
    display: "standalone",
    ...(options.backgroundColor ? { background_color: options.backgroundColor } : {}),
    ...(options.themeColor ? { theme_color: options.themeColor } : {}),
  };
}
