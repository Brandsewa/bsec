export interface MediaDerivativeItem {
  w: number;
  h?: number | undefined;
  bytes?: number | undefined;
  key: string;
  url?: string | undefined;
}

export interface MediaImageSource {
  url?: string | null | undefined;
  width?: number | null | undefined;
  height?: number | null | undefined;
  dominantColor?: string | null | undefined;
  focalX?: number | null | undefined;
  focalY?: number | null | undefined;
  derivatives?:
    | MediaDerivativeItem[]
    | Record<string, { key: string; width?: number | undefined; height?: number | undefined; bytes?: number | undefined; url?: string | undefined }>
    | null
    | undefined;
}

export interface MediaImageOptions {
  widths?: number[] | undefined;
  sizes?: string | undefined;
  cdnBaseUrl?: string | undefined;
}

export interface MediaImageResult {
  src: string;
  srcSet?: string | undefined;
  sizes?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  aspectRatio?: number | undefined;
  focal?: { x: number; y: number } | undefined;
  dominantColor?: string | undefined;
  placeholderColor?: string | undefined;
  objectPosition?: string | undefined;
}

/**
 * Resolves a public URL for a derived key based on the original asset's URL structure.
 * Preserves the custom origin / CDN domain if the original URL is absolute.
 */
export function buildDerivativeUrl(derivedKey: string, originalUrl?: string | null | undefined): string {
  const cleanKey = derivedKey.replace(/^\/+/, "");
  if (!originalUrl) {
    return `/media/${cleanKey}`;
  }

  if (originalUrl.startsWith("http://") || originalUrl.startsWith("https://")) {
    try {
      const parsed = new URL(originalUrl);
      return `${parsed.origin}/${cleanKey}`;
    } catch {
      // Fall through to path-based
    }
  }

  return `/media/${cleanKey}`;
}

/**
 * Pure helper for rendering responsive images across the storefront and admin (Phase 4 Plan S2).
 * Priority:
 * 1. Worker derivatives exist → srcSet from them, src = largest derivative <= 1024px.
 * 2. CDN_BASE_URL set → /cdn-cgi/image/ Cloudflare Image Transformation variants.
 * 3. Fallback → original URL, no srcSet.
 *
 * Always outputs intrinsic width, height, aspectRatio, dominantColor, and objectPosition.
 */
export function mediaImage(
  item: MediaImageSource | null | undefined,
  options?: MediaImageOptions | undefined,
): MediaImageResult {
  if (!item) {
    return { src: "" };
  }

  const originalUrl = item.url || "";
  const width = typeof item.width === "number" && item.width > 0 ? item.width : undefined;
  const height = typeof item.height === "number" && item.height > 0 ? item.height : undefined;
  const aspectRatio = width && height ? Number((width / height).toFixed(4)) : undefined;
  const dominantColor = item.dominantColor || undefined;
  const placeholderColor = dominantColor;

  let focal: { x: number; y: number } | undefined;
  let objectPosition: string | undefined;
  if (
    typeof item.focalX === "number" &&
    typeof item.focalY === "number" &&
    item.focalX >= 0 &&
    item.focalX <= 1 &&
    item.focalY >= 0 &&
    item.focalY <= 1
  ) {
    focal = { x: item.focalX, y: item.focalY };
    objectPosition = `${Math.round(item.focalX * 100)}% ${Math.round(item.focalY * 100)}%`;
  }

  // Normalize derivatives: could be array or record/map { w320: { key, width, ... } }
  let derivatives: MediaDerivativeItem[] | null = null;
  if (Array.isArray(item.derivatives)) {
    derivatives = item.derivatives;
  } else if (item.derivatives && typeof item.derivatives === "object") {
    derivatives = Object.entries(item.derivatives).map(([k, v]) => {
      const parsedW = v.width ?? parseInt(k.replace(/^w/, ""), 10);
      return {
        w: isNaN(parsedW) ? 640 : parsedW,
        h: v.height,
        bytes: v.bytes,
        key: v.key,
        url: v.url,
      };
    });
  }

  // 1. Worker derivatives exist
  if (derivatives && derivatives.length > 0) {
    const sorted = [...derivatives].sort((a, b) => a.w - b.w);
    const srcSet = sorted
      .map((d) => {
        const dUrl = d.url || buildDerivativeUrl(d.key, originalUrl);
        return `${dUrl} ${d.w}w`;
      })
      .join(", ");

    const underOrAt1024 = sorted.filter((d) => d.w <= 1024);
    const chosen = underOrAt1024.length > 0 ? underOrAt1024[underOrAt1024.length - 1] : sorted[0];
    const src = chosen ? chosen.url || buildDerivativeUrl(chosen.key, originalUrl) : originalUrl;

    return {
      src,
      srcSet,
      sizes: options?.sizes,
      width,
      height,
      aspectRatio,
      focal,
      dominantColor,
      placeholderColor,
      objectPosition,
    };
  }

  // 2. Cloudflare Images transform fallback if URL matches /cdn-cgi/image/ or cdnBaseUrl provided
  const cdnBase = options?.cdnBaseUrl;
  if (originalUrl && (originalUrl.includes("/cdn-cgi/image/") || Boolean(cdnBase))) {
    const cleanOrigin = cdnBase ? cdnBase.replace(/\/+$/, "") : "";
    const cleanPath = originalUrl.startsWith("http://") || originalUrl.startsWith("https://")
      ? new URL(originalUrl).pathname
      : originalUrl.startsWith("/") ? originalUrl : `/${originalUrl}`;

    const requestedWidths = options?.widths || [320, 640, 1024, 1600];
    // Do not upscale beyond original width if original width is known
    const eligibleWidths = width ? requestedWidths.filter((w) => w <= width || w === requestedWidths[0]) : requestedWidths;

    const srcSet = eligibleWidths
      .map((w) => `${cleanOrigin}/cdn-cgi/image/width=${w},format=auto${cleanPath} ${w}w`)
      .join(", ");

    const underOrAt1024 = eligibleWidths.filter((w) => w <= 1024);
    const chosenWidth = underOrAt1024.length > 0 ? underOrAt1024[underOrAt1024.length - 1] : eligibleWidths[0];
    const src = `${cleanOrigin}/cdn-cgi/image/width=${chosenWidth},format=auto${cleanPath}`;

    return {
      src,
      srcSet,
      sizes: options?.sizes,
      width,
      height,
      aspectRatio,
      focal,
      dominantColor,
      placeholderColor,
      objectPosition,
    };
  }

  // 3. Graceful fallback for original URL (SVGs, GIFs, legacy items)
  return {
    src: originalUrl,
    sizes: options?.sizes,
    width,
    height,
    aspectRatio,
    focal,
    dominantColor,
    placeholderColor,
    objectPosition,
  };
}
