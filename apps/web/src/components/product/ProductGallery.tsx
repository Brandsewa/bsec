"use client";

import { PLACEHOLDER_IMAGE_URL } from "@/lib/placeholder.ts";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { StorefrontMedia } from "@bs/domain";
// Subpath import: this is a client component. The package barrel would put every block, zod schema and view into the
// browser bundle (the /products/[slug] budget in perf-budget-bundle.int.test.ts is 100 KB gzipped).
import { mediaImage } from "@bs/blocks/media-image";

export interface ProductGalleryProps {
  media: StorefrontMedia[];
  title: string;
  /** Where the thumbnails sit on desktop. Phones always put them below. */
  thumbPosition?: "bottom" | "left" | "right" | undefined;
}

const ARROW = {
  left: "M15 18l-6-6 6-6",
  right: "M9 18l6-6-6-6",
  up: "M18 15l-6-6-6 6",
  down: "M6 9l6 6 6-6",
};

function Chevron({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ROUND_BUTTON =
  "inline-flex h-9 w-9 items-center justify-center rounded-full bg-background/95 text-foreground shadow-md ring-1 ring-black/5 transition hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40";

export function ProductGallery({ media, title, thumbPosition = "bottom" }: ProductGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);

  const items = media.filter((m) => Boolean(m.url));
  const count = items.length;
  const activeItem = items[selectedIndex] ?? items[0];
  const firstImage = items.find((m) => m.kind !== "video") ?? items[0];

  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      setSelectedIndex((i) => (i + delta + count) % count);
    },
    [count],
  );

  // Keep the chosen thumbnail in view when the picture changes by arrow, swipe or keyboard.
  useEffect(() => {
    const el = stripRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  const imgInfo = mediaImage(
    activeItem
      ? {
          url: activeItem.url,
          width: activeItem.width,
          height: activeItem.height,
          focalX: activeItem.focalX,
          focalY: activeItem.focalY,
          dominantColor: activeItem.dominantColor,
          derivatives: activeItem.derivatives,
        }
      : null,
    { sizes: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 600px" },
  );

  if (count === 0) {
    return (
      <div className="aspect-square w-full overflow-hidden rounded-2xl bg-surface/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PLACEHOLDER_IMAGE_URL} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }

  const isVideo = activeItem?.kind === "video";
  const side = thumbPosition !== "bottom";
  const strip = (
    <div className={`relative ${side ? "lg:w-20 lg:shrink-0 lg:self-stretch" : ""}`}>
      <div
        ref={stripRef}
        className={`flex gap-2.5 overflow-x-auto scroll-smooth px-0.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${side ? "lg:absolute lg:inset-0 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:px-0.5" : ""}`}
        role="tablist"
        aria-label="Product thumbnails"
        aria-orientation={side ? "vertical" : "horizontal"}
      >
        {items.map((item, idx) => {
          const isSelected = idx === selectedIndex;
          const itemIsVideo = item.kind === "video";
          const thumbItem = itemIsVideo ? (firstImage ?? item) : item;
          const thumbInfo = mediaImage(
            thumbItem
              ? { url: thumbItem.url, width: thumbItem.width, height: thumbItem.height, focalX: thumbItem.focalX, focalY: thumbItem.focalY, dominantColor: thumbItem.dominantColor, derivatives: thumbItem.derivatives }
              : null,
          );
          return (
            <button
              key={item.id || item.mediaId || idx}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-label={itemIsVideo ? `Video ${idx + 1} of ${count}` : (item.alt ?? `${title}, picture ${idx + 1} of ${count}`)}
              onClick={() => setSelectedIndex(idx)}
              className={`relative h-[4.5rem] w-[4.5rem] flex-shrink-0 overflow-hidden rounded-lg border-2 transition-all lg:h-20 lg:w-20 ${
                isSelected ? "border-primary ring-2 ring-primary/20" : "border-border/60 opacity-80 hover:border-border hover:opacity-100"
              }`}
              style={{ backgroundColor: thumbInfo.dominantColor ?? undefined }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbInfo.src} srcSet={thumbInfo.srcSet} alt="" loading="lazy" style={{ objectPosition: thumbInfo.objectPosition }} className="h-full w-full object-cover" />
              {itemIsVideo ? (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white shadow-xs">
                    <svg aria-hidden className="h-3 w-3 translate-x-0.5 fill-current" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {count > 4 || (side && count > 3) ? (
        <>
          {/* small icons to move through the thumbnails: horizontal on phones and for the bottom strip, vertical for a side strip on desktop */}
          <button type="button" aria-label="Previous thumbnails" onClick={() => stripRef.current?.scrollBy({ left: -160, top: 0, behavior: "smooth" })} className={`${ROUND_BUTTON} !h-7 !w-7 absolute left-0 top-1/2 -translate-y-1/2 ${side ? "lg:hidden" : ""}`}>
            <Chevron d={ARROW.left} className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Next thumbnails" onClick={() => stripRef.current?.scrollBy({ left: 160, top: 0, behavior: "smooth" })} className={`${ROUND_BUTTON} !h-7 !w-7 absolute right-0 top-1/2 -translate-y-1/2 ${side ? "lg:hidden" : ""}`}>
            <Chevron d={ARROW.right} className="h-3.5 w-3.5" />
          </button>
          {side ? (
            <>
              <button type="button" aria-label="Previous thumbnails" onClick={() => stripRef.current?.scrollBy({ top: -160, left: 0, behavior: "smooth" })} className={`${ROUND_BUTTON} !h-7 !w-7 absolute left-1/2 top-1 hidden -translate-x-1/2 lg:inline-flex`}>
                <Chevron d={ARROW.up} className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label="Next thumbnails" onClick={() => stripRef.current?.scrollBy({ top: 160, left: 0, behavior: "smooth" })} className={`${ROUND_BUTTON} !h-7 !w-7 absolute bottom-1 left-1/2 hidden -translate-x-1/2 lg:inline-flex`}>
                <Chevron d={ARROW.down} className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );

  return (
    <div
      className={`flex flex-col gap-3 ${thumbPosition === "left" ? "lg:flex-row" : thumbPosition === "right" ? "lg:flex-row-reverse" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          go(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          go(-1);
        }
      }}
    >
      {side && count > 1 ? <div className="order-2 lg:order-none lg:flex">{strip}</div> : null}

      <div className="relative min-w-0 flex-1">
        <div
          className="group relative aspect-square w-full overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-xs"
          style={{ backgroundColor: imgInfo.dominantColor ?? undefined }}
          onTouchStart={(e) => {
            touchX.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const start = touchX.current;
            touchX.current = null;
            const end = e.changedTouches[0]?.clientX;
            if (start === null || end === undefined || Math.abs(end - start) < 50) return;
            go(end < start ? 1 : -1);
          }}
        >
          {isVideo ? (
            <video key={activeItem?.url} controls playsInline preload="none" poster={firstImage?.url} className="h-full w-full bg-black object-contain object-center" src={activeItem?.url}>
              Your browser does not support the video tag.
            </video>
          ) : (
            <button type="button" onClick={() => setLightbox(true)} aria-label="Open larger picture" aria-haspopup="dialog" className="block h-full w-full cursor-zoom-in">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgInfo.src}
                srcSet={imgInfo.srcSet}
                sizes={imgInfo.sizes}
                alt={activeItem?.alt ?? title}
                fetchPriority={selectedIndex === 0 ? "high" : "auto"}
                loading={selectedIndex === 0 ? "eager" : "lazy"}
                style={{ objectPosition: imgInfo.objectPosition }}
                className="h-full w-full object-cover transition-opacity duration-300"
              />
            </button>
          )}

          {count > 1 ? (
            <>
              <button type="button" aria-label="Previous picture" onClick={() => go(-1)} className={`${ROUND_BUTTON} absolute left-2.5 top-1/2 -translate-y-1/2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100`}>
                <Chevron d={ARROW.left} />
              </button>
              <button type="button" aria-label="Next picture" onClick={() => go(1)} className={`${ROUND_BUTTON} absolute right-2.5 top-1/2 -translate-y-1/2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100`}>
                <Chevron d={ARROW.right} />
              </button>
              <span className="pointer-events-none absolute bottom-2.5 right-2.5 rounded-full bg-black/60 px-2.5 py-0.5 text-xs font-medium text-white" aria-live="polite">
                {selectedIndex + 1} / {count}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {thumbPosition === "bottom" && count > 1 ? strip : null}

      {lightbox ? <Lightbox items={items} index={selectedIndex} title={title} onIndex={setSelectedIndex} onClose={() => setLightbox(false)} /> : null}
    </div>
  );
}

/** Full-screen view of the pictures and videos: arrows, keyboard (Left, Right, Escape), swipe, focus kept inside, counter. */
function Lightbox({ items, index, title, onIndex, onClose }: { items: StorefrontMedia[]; index: number; title: string; onIndex: (i: number) => void; onClose: () => void }) {
  const count = items.length;
  const item = items[index] ?? items[0];
  const panelRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  const step = useCallback((d: number) => onIndex((index + d + count) % count), [index, count, onIndex]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.body.style.overflow = previous;
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "Tab") {
        const f = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), video") ?? []);
        const first = f[0];
        const last = f[f.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  // Load the neighbours so the arrows feel instant.
  useEffect(() => {
    for (const d of [1, -1]) {
      const n = items[(index + d + count) % count];
      if (n && n.kind !== "video" && n.url) {
        const img = new Image();
        img.src = n.url;
      }
    }
  }, [index, items, count]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${title}, enlarged pictures`}
      className="fixed inset-0 z-[80] flex flex-col bg-black/90"
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (start === null || end === undefined || Math.abs(end - start) < 50) return;
        step(end < start ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm" aria-live="polite">
          {index + 1} / {count}
        </span>
        <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10">
          <svg aria-hidden className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {item?.kind === "video" ? (
          <video key={item.url} controls autoPlay playsInline src={item.url} className="max-h-full max-w-full rounded-lg bg-black" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item?.url} alt={item?.alt ?? title} className="max-h-full max-w-full rounded-lg object-contain" />
        )}
        {count > 1 ? (
          <>
            <button type="button" aria-label="Previous picture" onClick={() => step(-1)} className={`${ROUND_BUTTON} absolute left-3 top-1/2 -translate-y-1/2 sm:left-6`}>
              <Chevron d={ARROW.left} />
            </button>
            <button type="button" aria-label="Next picture" onClick={() => step(1)} className={`${ROUND_BUTTON} absolute right-3 top-1/2 -translate-y-1/2 sm:right-6`}>
              <Chevron d={ARROW.right} />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
