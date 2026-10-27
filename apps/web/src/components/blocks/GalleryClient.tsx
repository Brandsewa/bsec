"use client";

import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import type { GalleryViewerImage } from "@bs/blocks";

type Viewer = ComponentType<{ images: GalleryViewerImage[]; initialOpen: number; children: ReactNode }>;

/**
 * The gallery grid stays server-rendered. The viewer (arrows, thumbnails, keyboard, swipe) is a separate chunk fetched on the first
 * click, so no page carries it up front; it then opens on the picture that was clicked.
 */
export function GalleryClient({ images, children }: { images: GalleryViewerImage[]; children: ReactNode }) {
  const [start, setStart] = useState<number | null>(null);
  const [V, setV] = useState<Viewer | null>(null);

  const open = (target: EventTarget | null) => {
    const item = (target as HTMLElement | null)?.closest<HTMLElement>("[data-gal-i]");
    if (!item) return false;
    setStart(Number(item.dataset.galI));
    if (!V) void import("./GalleryViewer.tsx").then((m) => setV(() => m.GalleryViewer));
    return true;
  };

  if (V && start !== null) {
    return (
      <V images={images} initialOpen={start}>
        {children}
      </V>
    );
  }
  return (
    <div
      onClick={(e) => open(e.target) && e.preventDefault()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open(e.target) && e.preventDefault()}
    >
      {children}
    </div>
  );
}
