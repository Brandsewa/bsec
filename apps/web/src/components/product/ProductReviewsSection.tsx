"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { Review } from "@bs/contracts";
import { CloseButton, Overlay, ReviewCard, STAR_PATH, Stars } from "./reviews-shared.tsx";
import { ReviewsDrawerLazy } from "./ReviewsDrawerLazy.tsx";

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


export function ProductReviewsSection({ productId, productTitle }: ProductReviewsProps) {
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<Review[]>([]);
  const [summary, setSummary] = useState({ total: 0, ratingAvg: 0, ratingCount: 0 });
  const [formOpen, setFormOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Form state
  const [rating, setRating] = useState(5);
  const [reviewerName, setReviewerName] = useState("");
  // Reviews are for signed-in shoppers: null while checking, then the shopper or false.
  const [shopper, setShopper] = useState<{ name: string } | false | null>(null);
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
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/storefront/customer/profile", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { signedIn: false }))
      .then((data: { signedIn?: boolean; name?: string }) => {
        if (cancelled) return;
        setShopper(data.signedIn ? { name: data.name ?? "" } : false);
        if (data.signedIn && data.name) setReviewerName((n) => n || (data.name ?? ""));
      })
      .catch(() => {
        if (!cancelled) setShopper(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    <section className="mt-6 border-t border-border pt-8 sm:mt-16 sm:pt-12" id="reviews-section">
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
        {shopper === false ? (
          <a
            href={`/account/login?next=${encodeURIComponent(typeof window === "undefined" ? "/" : `${window.location.pathname}#reviews-section`)}`}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Log in to review
          </a>
        ) : (
          <button
            type="button"
            disabled={shopper === null}
            onClick={() => {
              setFormSuccess(null);
              setFormError(null);
              setFormOpen(true);
            }}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            Write a Review
          </button>
        )}
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
      {formOpen && shopper ? (
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

            <div>
              <label htmlFor="rv-name" className="mb-1 block text-xs font-semibold text-foreground">Your Name *</label>
              <input id="rv-name" type="text" required value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} placeholder="e.g. John Doe" className={input} />
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

      {/* Every review: a side drawer, loaded only when opened (own sorting and paging) */}
      {drawerOpen ? <ReviewsDrawerLazy productId={productId} ratingAvg={summary.ratingAvg} total={summary.total} onClose={closeDrawer} /> : null}
    </section>
  );
}
