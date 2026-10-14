"use client";

import React, { useState } from "react";
import type { StorefrontMedia } from "@bs/domain";

export interface ProductGalleryProps {
  media: StorefrontMedia[];
  title: string;
}

function generateImageSrcSet(url?: string): { src: string; srcSet?: string; sizes?: string } {
  if (!url) return { src: "" };

  // If the image is served via Cloudflare Images / CDN transform URL, produce responsive AVIF/WebP variants
  if (url.includes("/cdn-cgi/image/")) {
    const widths = [360, 640, 750, 1080];
    const srcSet = widths
      .map((w) => {
        const transformed = url.replace(
          /\/cdn-cgi\/image\/[^/]+/,
          `/cdn-cgi/image/width=${w},fit=cover,format=auto,quality=85`,
        );
        return `${transformed} ${w}w`;
      })
      .join(", ");
    return {
      src: url,
      srcSet,
      sizes: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 600px",
    };
  }

  // If image URL is already WebP or AVIF, provide width descriptors or use as-is
  return {
    src: url,
    srcSet: `${url} 1x, ${url} 2x`,
    sizes: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 600px",
  };
}

export function ProductGallery({ media, title }: ProductGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items = media.filter((m) => Boolean(m.url));
  const activeItem = items[selectedIndex] ?? items[0];
  const firstImage = items.find((m) => m.kind !== "video") ?? items[0];
  const { src, srcSet, sizes } = generateImageSrcSet(activeItem?.url);

  if (items.length === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-dashed border-border/80 bg-surface/50 text-text/60">
        <div className="text-center p-6">
          <svg
            className="mx-auto h-12 w-12 text-text/40 mb-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="text-sm font-medium">No image available</p>
        </div>
      </div>
    );
  }

  const isVideo = activeItem?.kind === "video";

  return (
    <div className="flex flex-col gap-4">
      {/* Main item with fixed aspect ratio */}
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-xs">
        {isVideo ? (
          <video
            key={activeItem?.url}
            controls
            playsInline
            preload="none"
            poster={firstImage?.url}
            className="h-full w-full object-contain object-center bg-black"
            src={activeItem?.url}
          >
            Your browser does not support the video tag.
          </video>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={src}
            srcSet={srcSet}
            sizes={sizes}
            alt={activeItem?.alt ?? title}
            fetchPriority="high"
            loading="eager"
            className="h-full w-full object-cover object-center transition-all duration-300"
          />
        )}
      </div>

      {/* Thumbnail strip */}
      {items.length > 1 && (
        <div className="flex gap-3 overflow-x-auto pb-2 pt-1 scrollbar-none" role="tablist" aria-label="Product thumbnails">
          {items.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            const itemIsVideo = item.kind === "video";
            const thumbUrl = itemIsVideo ? (firstImage?.url || item.url) : item.url;
            return (
              <button
                key={item.id || item.mediaId || idx}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-label={itemIsVideo ? `Video thumbnail ${idx + 1}` : (item.alt ?? `${title} thumbnail ${idx + 1}`)}
                onClick={() => setSelectedIndex(idx)}
                className={`relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border-2 transition-all ${
                  isSelected
                    ? "border-primary ring-2 ring-primary/20 scale-95"
                    : "border-border/60 hover:border-border hover:opacity-80"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbUrl}
                  alt={item.alt ?? `${title} thumbnail ${idx + 1}`}
                  loading="lazy"
                  className="h-full w-full object-cover object-center"
                />
                {itemIsVideo && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white shadow-xs">
                      <svg className="h-3 w-3 translate-x-0.5 fill-current" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
