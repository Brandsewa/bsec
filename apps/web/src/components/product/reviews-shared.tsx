"use client";

import React, { useEffect, useRef } from "react";
import type { Review } from "@bs/contracts";

/** Pieces shared by the reviews section and its lazily loaded drawer. */

export const STAR_PATH =
  "M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z";

export function Stars({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
  return (
    <span className="flex items-center" role="img" aria-label={`${value} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} className={`${size} ${i < Math.round(value) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d={STAR_PATH} />
        </svg>
      ))}
    </span>
  );
}

export function VerifiedTick() {
  return (
    <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400" title="Verified purchase">
      <svg className="h-4 w-4" viewBox="0 0 24 24" role="img" aria-label="Verified purchase">
        <circle cx="12" cy="12" r="11" fill="currentColor" />
        <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function ReviewCard({ rev, full }: { rev: Review; full?: boolean }) {
  return (
    <article className={`flex ${full ? "" : "h-full "}flex-col gap-2 rounded-xl border border-border bg-card/60 p-4 shadow-sm`}>
      <Stars value={rev.rating} />
      {rev.title ? <h4 className="text-sm font-semibold text-foreground">{rev.title}</h4> : null}
      <p className={`whitespace-pre-line text-sm leading-relaxed text-muted-foreground ${full ? "" : "line-clamp-5"}`}>{rev.body}</p>
      {rev.replyText ? (
        <div className="rounded-lg border-l-2 border-primary bg-muted/40 p-3 text-xs">
          <span className="font-semibold text-foreground">Store response: </span>
          <p className="mt-1 text-muted-foreground">{rev.replyText}</p>
        </div>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          {rev.reviewerName}
          {rev.isVerifiedPurchase ? <VerifiedTick /> : null}
        </span>
        <time dateTime={rev.createdAt}>{dateOf(rev.createdAt)}</time>
      </div>
    </article>
  );
}

/** A modal or side panel: closes on Escape and on a click outside, keeps the page from scrolling behind it. */
export function Overlay({ side, label, onClose, children }: { side?: "right"; label: string; onClose: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className={`fixed inset-0 z-[90] flex bg-black/50 ${side === "right" ? "justify-end" : "items-center justify-center p-4"}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={
          side === "right"
            ? "flex h-full w-full max-w-md flex-col bg-background shadow-xl outline-none"
            : "max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-background shadow-xl outline-none"
        }
      >
        {children}
      </div>
    </div>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
