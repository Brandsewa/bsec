import type { Metadata } from "next";
import type { StorefrontShareImage } from "@bs/domain";

/**
 * Next replaces a page's whole `openGraph` and `twitter` objects instead of merging them with the layout's, so a page that sets
 * its own title and description loses the layout's default image. This puts the store's default share image back on a page that
 * has no image of its own (docs/SEO-GEO-AEO-PLAN.md Phase 2). A page with its own image is left as it is.
 */
export function withShareImage(meta: Metadata, image: StorefrontShareImage | null | undefined): Metadata {
  if (!image) return meta;
  const og = meta.openGraph;
  const tw = meta.twitter;
  const hasOgImage = Boolean(og && "images" in og && og.images && (Array.isArray(og.images) ? og.images.length > 0 : true));
  const hasTwImage = Boolean(tw && "images" in tw && tw.images && (Array.isArray(tw.images) ? tw.images.length > 0 : true));
  const next: Metadata = { ...meta };
  if (og && !hasOgImage) {
    next.openGraph = { ...og, images: [{ url: image.url, ...(image.width ? { width: image.width } : {}), ...(image.height ? { height: image.height } : {}), ...(image.alt ? { alt: image.alt } : {}) }] };
  }
  if (tw && !hasTwImage) {
    next.twitter = { ...tw, images: [image.url] } as Metadata["twitter"];
  }
  return next;
}
