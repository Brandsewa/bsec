"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { GalleryViewerImage } from "@bs/blocks";

/**
 * The gallery's viewer. The grid stays server-rendered; one delegated handler opens the picture that was clicked in a full-screen
 * viewer with previous / next, a thumbnail strip, the keyboard (Esc, left, right) and a swipe on touch screens.
 */
export function GalleryViewer({ images, children, initialOpen = null }: { images: GalleryViewerImage[]; children: ReactNode; initialOpen?: number | null }) {
  const [open, setOpen] = useState<number | null>(initialOpen);
  const opener = useRef<HTMLElement | null>(null);
  const touchX = useRef<number | null>(null);
  const count = images.length;

  const show = (target: EventTarget | null) => {
    const item = (target as HTMLElement | null)?.closest<HTMLElement>("[data-gal-i]");
    if (!item) return false;
    opener.current = item;
    setOpen(Number(item.dataset.galI));
    return true;
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (show(e.target)) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === "Enter" || e.key === " ") && show(e.target)) e.preventDefault();
  };

  const close = useCallback(() => {
    setOpen(null);
    opener.current?.focus();
  }, []);
  const step = useCallback((d: number) => setOpen((i) => (i === null ? i : (i + d + count) % count)), [count]);

  useEffect(() => {
    if (open === null) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close, step]);

  const current = open === null ? null : images[open];

  return (
    <>
      <div onClick={onClick} onKeyDown={onKey}>
        {children}
      </div>
      {current ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          className="fixed inset-0 z-[1000] flex flex-col bg-black/90 text-white"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
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
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span aria-live="polite">
              {(open ?? 0) + 1} / {count}
            </span>
            <button type="button" onClick={close} aria-label="Close viewer" className="rounded-full p-2 text-2xl leading-none hover:bg-white/10">
              ×
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-14" onClick={(e) => e.target === e.currentTarget && close()}>
            {count > 1 ? (
              <button type="button" onClick={() => step(-1)} aria-label="Previous image" className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-2xl hover:bg-black/70 sm:left-3">
                ‹
              </button>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.src} alt={current.alt} className="max-h-full max-w-full object-contain" />
            {count > 1 ? (
              <button type="button" onClick={() => step(1)} aria-label="Next image" className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-2xl hover:bg-black/70 sm:right-3">
                ›
              </button>
            ) : null}
          </div>
          {current.caption ? <p className="px-4 pb-2 pt-3 text-center text-sm text-white/80">{current.caption}</p> : null}
          {count > 1 ? (
            <div className="flex gap-2 overflow-x-auto px-4 py-3" role="tablist" aria-label="Thumbnails">
              {images.map((im, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === open}
                  aria-label={`Show image ${i + 1}`}
                  onClick={() => setOpen(i)}
                  ref={(el) => {
                    if (el && i === open) el.scrollIntoView({ block: "nearest", inline: "center" });
                  }}
                  className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 sm:h-16 sm:w-16 ${i === open ? "border-white" : "border-transparent opacity-60 hover:opacity-100"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.thumb} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
