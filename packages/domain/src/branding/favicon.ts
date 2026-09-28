/**
 * Favicon & Web Manifest generation utilities per PLAN §8.1.
 * Supports resizing favicon source images to 16, 32, 180, 192, 512px
 * via Cloudflare Images transform pipeline, and building W3C Web Manifests.
 */
import { buildCloudflareImageTransformUrl } from "../media/storage.ts";

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

export interface FaviconVariantUrl {
  size: FaviconSize;
  url: string;
}

/**
 * Generates resized favicon variant URLs for all required dimensions
 * (16x16, 32x32, 180x180, 192x192, 512x512) using Cloudflare Images transforms.
 */
export function generateFaviconVariantUrls(
  cdnBaseUrl: string,
  sourceImagePath: string,
): Record<FaviconSize, string> {
  const result = {} as Record<FaviconSize, string>;

  for (const size of FAVICON_SIZES) {
    result[size] = buildCloudflareImageTransformUrl(cdnBaseUrl, sourceImagePath, {
      width: size,
      height: size,
      fit: "contain",
      format: "auto",
    });
  }

  return result;
}

/**
 * Builds a standard W3C Web App Manifest referencing icon files.
 * Renamed to buildManifestOnly to make clear that this function builds
 * the JSON descriptor rather than rasterizing binary pixel buffers.
 */
export function buildManifestOnly(
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

/**
 * Backward compatibility alias for buildManifestOnly.
 * Note: Does not perform binary image generation; use generateFaviconVariantUrls for CDN transform URLs.
 */
export const generateWebManifest = buildManifestOnly;
