"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Review } from "@bs/contracts";

interface ProductReviewsProps {
  productId: string;
  productTitle: string;
}

interface ReviewsResponse {
  items: Review[];
  total: number;
  ratingAvg: string;
  ratingCount: number;
}

const PAGE_SIZE = 10;
/** Cards shown on the page: two rows of three on a desktop. "Show more" opens the side drawer with every review. */
const CARDS_ON_PAGE = 6;

const STAR_PATH =
  "M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z";

function Stars({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
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

function VerifiedTick() {
  return (
    <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400" title="Verified purchase">
      <svg className="h-4 w-4" viewBox="0 0 24 24" role="img" aria-label="Verified purchase">
        <circle cx="12" cy="12" r="11" fill="currentColor" />
        <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function ReviewCard({ rev, full }: { rev: Review; full?: boolean }) {
  return (
    <article className="flex h-full flex-col gap-2 rounded-xl border border-border bg-card/60 p-4 shadow-sm">
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
function Overlay({ side, label, onClose, children }: { side?: "right"; label: string; onClose: () => void; children: React.ReactNode }) {
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

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

export function ProductReviewsSection({ productId, productTitle }: ProductReviewsProps) {
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<Review[]>([]);
  const [summary, setSummary] = useState({ total: 0, ratingAvg: 0, ratingCount: 0 });
  const [nextPage, setNextPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Form state
  const [rating, setRating] = useState(5);
  const [reviewerName, setReviewerName] = useState("");
  const [email, setEmail] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (page: number, replace: boolean) => {
      const res = await fetch(`/api/storefront/products/${encodeURIComponent(productId)}/reviews?page=${page}&limit=${PAGE_SIZE}`);
      if (!res.ok) return;
      const data = (await res.json()) as ReviewsResponse;
      setItems((prev) => (replace ? data.items : [...prev, ...data.items.filter((n) => !prev.some((p) => p.id === n.id))]));
      setSummary({ total: data.total, ratingAvg: Number(data.ratingAvg ?? 0), ratingCount: data.ratingCount });
      setNextPage(page + 1);
    },
    [productId],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/storefront/products/${encodeURIComponent(productId)}/reviews?page=1&limit=${PAGE_SIZE}`)
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ReviewsResponse;
        setItems(data.items);
        setSummary({ total: data.total, ratingAvg: Number(data.ratingAvg ?? 0), ratingCount: data.ratingCount });
        setNextPage(2);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      await fetchPage(nextPage, false);
    } catch {
      /* the button stays, so it can be tried again */
    } finally {
      setLoadingMore(false);
    }
  };

  const closeForm = useCallback(() => setFormOpen(false), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    if (!reviewerName.trim()) return setFormError("Please enter your name");
    if (!body.trim()) return setFormError("Please write your review");

    setSubmitting(true);
    try {
      const res = await fetch(`/api/storefront/products/${encodeURIComponent(productId)}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewerName: reviewerName.trim(),
          email: email.trim() || undefined,
          orderNumber: orderNumber.trim() || undefined,
          rating,
          title: title.trim() || undefined,
          body: body.trim(),
          honeypot: honeypot || undefined,
        }),
      });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setFormError(json.message ?? json.error ?? "Failed to submit review");
      } else {
        setFormSuccess(json.message ?? "Thank you for your review!");
        setReviewerName("");
        setEmail("");
        setOrderNumber("");
        setTitle("");
        setBody("");
        setRating(5);
        void fetchPage(1, true).catch(() => {});
      }
    } catch {
      setFormError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const { total, ratingAvg, ratingCount } = summary;
  const onPage = items.slice(0, CARDS_ON_PAGE);
  const hasMore = total > onPage.length;
  const input = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <section className="mt-16 border-t border-border pt-12" id="reviews-section">
      <div className="flex flex-col gap-6 border-b border-border/60 pb-8 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Customer Reviews</h2>
          <div className="mt-2 flex items-center gap-3">
            <Stars value={ratingAvg} size="h-5 w-5" />
            <span className="text-sm font-semibold text-foreground">{ratingAvg > 0 ? ratingAvg.toFixed(1) : "0.0"} out of 5</span>
            <span className="text-sm text-muted-foreground">
              ({ratingCount} {ratingCount === 1 ? "review" : "reviews"})
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormSuccess(null);
            setFormError(null);
            setFormOpen(true);
          }}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          Write a Review
        </button>
      </div>

      {/* Review cards: two rows, then "Show more" */}
      {!loaded ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading reviews...</div>
      ) : onPage.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No customer reviews yet. Be the first to review this product!</div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {onPage.map((rev, i) => (
              <div key={rev.id} className={i >= 3 ? "hidden sm:block" : undefined}>
                <ReviewCard rev={rev} />
              </div>
            ))}
          </div>
          {hasMore ? (
            <div className="mt-6 flex justify-center">
              <button type="button" onClick={() => setDrawerOpen(true)} className="rounded-lg border border-input px-5 py-2 text-sm font-semibold transition-colors hover:bg-muted">
                Show more reviews ({total})
              </button>
            </div>
          ) : null}
        </>
      )}

      {/* Write a review: a pop-up */}
      {formOpen ? (
        <Overlay label={`Write a review for ${productTitle}`} onClose={closeForm}>
          <form onSubmit={handleSubmit} className="space-y-4 p-6" noValidate>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-foreground">Write a review for {productTitle}</h3>
              <CloseButton onClick={closeForm} />
            </div>

            {formSuccess ? <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-600 dark:text-emerald-400">{formSuccess}</div> : null}
            {formError ? <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">{formError}</div> : null}

            {/* Honeypot field (hidden from users) */}
            <div className="hidden" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input type="text" id="website" name="website" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} tabIndex={-1} autoComplete="off" />
            </div>

            <div>
              <span className="mb-1 block text-sm font-medium text-foreground">Your Rating *</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button type="button" key={s} onClick={() => setRating(s)} aria-label={`${s} star${s > 1 ? "s" : ""}`} aria-pressed={s === rating} className="p-1 text-amber-400 transition-transform hover:scale-110">
                    <svg className={`h-7 w-7 ${s <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d={STAR_PATH} />
                    </svg>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="rv-name" className="mb-1 block text-xs font-semibold text-foreground">Your Name *</label>
                <input id="rv-name" type="text" required value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} placeholder="e.g. John Doe" className={input} />
              </div>
              <div>
                <label htmlFor="rv-email" className="mb-1 block text-xs font-semibold text-foreground">Email (for verification)</label>
                <input id="rv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. john@example.com" className={input} />
              </div>
            </div>

            <div>
              <label htmlFor="rv-order" className="mb-1 block text-xs font-semibold text-foreground">Order Number (optional)</label>
              <input id="rv-order" type="text" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="e.g. #ORD-1001" className={input} />
            </div>

            <div>
              <label htmlFor="rv-title" className="mb-1 block text-xs font-semibold text-foreground">Review Headline</label>
              <input id="rv-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Excellent quality and fast shipping" className={input} />
            </div>

            <div>
              <label htmlFor="rv-body" className="mb-1 block text-xs font-semibold text-foreground">Your Review *</label>
              <textarea id="rv-body" required rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share what you liked or how this product helped you..." className={input} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={closeForm} className="rounded-lg border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-muted">
                {formSuccess ? "Close" : "Cancel"}
              </button>
              <button type="submit" disabled={submitting} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                {submitting ? "Submitting..." : "Submit Review"}
              </button>
            </div>
          </form>
        </Overlay>
      ) : null}

      {/* Every review: a side drawer */}
      {drawerOpen ? (
        <Overlay side="right" label="All customer reviews" onClose={closeDrawer}>
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">All reviews</h3>
              <p className="text-xs text-muted-foreground">
                {ratingAvg.toFixed(1)} out of 5 · {total} {total === 1 ? "review" : "reviews"}
              </p>
            </div>
            <CloseButton onClick={closeDrawer} />
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {items.map((rev) => (
              <ReviewCard key={rev.id} rev={rev} full />
            ))}
            {items.length < total ? (
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="w-full rounded-lg border border-input px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-50">
                {loadingMore ? "Loading..." : "Load more reviews"}
              </button>
            ) : null}
          </div>
        </Overlay>
      ) : null}
    </section>
  );
}
