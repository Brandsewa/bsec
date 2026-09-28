"use client";

import React, { useState } from "react";
import type { StorefrontMedia } from "@bs/domain";

export interface ProductGalleryProps {
  media: StorefrontMedia[];
  title: string;
}

export function ProductGallery({ media, title }: ProductGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const images = media.filter((m) => Boolean(m.url));
  const activeImage = images[selectedIndex] ?? images[0];

  if (images.length === 0) {
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

  return (
    <div className="flex flex-col gap-4">
      {/* Main Image with fixed aspect ratio */}
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-xs">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={activeImage?.url}
          alt={activeImage?.alt ?? title}
          fetchPriority="high"
          loading="eager"
          className="h-full w-full object-cover object-center transition-all duration-300"
        />
      </div>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="flex gap-3 overflow-x-auto pb-2 pt-1 scrollbar-none" role="tablist" aria-label="Product thumbnails">
          {images.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={item.id || item.mediaId || idx}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedIndex(idx)}
                className={`relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border-2 transition-all ${
                  isSelected
                    ? "border-primary ring-2 ring-primary/20 scale-95"
                    : "border-border/60 hover:border-border hover:opacity-80"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt={item.alt ?? `${title} thumbnail ${idx + 1}`}
                  loading="lazy"
                  className="h-full w-full object-cover object-center"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
