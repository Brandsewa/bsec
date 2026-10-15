"use client";

import React, { useEffect, useRef, useState } from "react";
import { paragraphs } from "@/lib/description-text.ts";

/**
 * The short description cut after two lines with a "Read more" link that opens the full description in a popup.
 * `full` is the product's long description; without one the popup shows the short text in full.
 */
export function ProductDescription({ title, short, full, clamp }: { title: string; short: string; full: string; clamp: boolean }) {
  const [open, setOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const preview = short || full;

  useEffect(() => {
    const el = textRef.current;
    if (!el || !clamp) return;
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [clamp, preview]);

  if (!preview) return null;
  if (!clamp) return <p className="text-base leading-relaxed text-muted-foreground">{preview}</p>;

  const popupText = full || short;
  const canOpen = overflowing || (full !== "" && full !== preview);

  return (
    <div>
      <p ref={textRef} className="line-clamp-2 text-base leading-relaxed text-muted-foreground">
        {preview}
      </p>
      {canOpen ? (
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="mt-1 text-sm font-medium text-foreground underline underline-offset-4 hover:no-underline">
          Read more
        </button>
      ) : null}
      {open ? <DescriptionDialog title={title} text={popupText} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function DescriptionDialog({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const f = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button, a[href]") ?? []);
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
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={`About ${title}`} className="bs-skin relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-t-2xl bg-background text-foreground shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold leading-snug">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-muted">
            <svg aria-hidden className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-muted-foreground">
          {paragraphs(text).map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
