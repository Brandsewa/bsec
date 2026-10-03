"use client";

import React, { useEffect, useState } from "react";
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

export function ProductReviewsSection({ productId, productTitle }: ProductReviewsProps) {
  const [page, setPage] = useState(1);
  const [isOpenForm, setIsOpenForm] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [reviewsData, setReviewsData] = useState<ReviewsResponse | null>(null);

  const currentKey = `${productId}:${page}`;
  const isLoading = loadedKey !== currentKey;

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

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/storefront/reviews?productId=${encodeURIComponent(productId)}&page=${page}&limit=10`)
      .then(async (res) => {
        if (res.ok && !cancelled) {
          const data = (await res.json()) as ReviewsResponse;
          setReviewsData(data);
          setLoadedKey(`${productId}:${page}`);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedKey(`${productId}:${page}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [productId, page]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!reviewerName.trim()) {
      setFormError("Please enter your name");
      return;
    }
    if (!body.trim()) {
      setFormError("Please write your review");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/storefront/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
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
        setFormError(json.error ?? "Failed to submit review");
      } else {
        setFormSuccess(json.message ?? "Thank you for your review!");
        setReviewerName("");
        setEmail("");
        setOrderNumber("");
        setTitle("");
        setBody("");
        setRating(5);
        if (page === 1) {
          fetch(`/api/storefront/reviews?productId=${encodeURIComponent(productId)}&page=1&limit=10`)
            .then(async (r) => {
              if (r.ok) {
                const data = (await r.json()) as ReviewsResponse;
                setReviewsData(data);
              }
            })
            .catch(() => {});
        } else {
          setPage(1);
        }
      }
    } catch {
      setFormError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const reviews = reviewsData?.items ?? [];
  const total = reviewsData?.total ?? 0;
  const ratingAvg = Number(reviewsData?.ratingAvg ?? 0);
  const ratingCount = reviewsData?.ratingCount ?? 0;

  return (
    <section className="mt-16 border-t border-border pt-12" id="reviews-section">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pb-8 border-b border-border/60">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Customer Reviews</h2>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex items-center text-amber-400">
              {Array.from({ length: 5 }).map((_, i) => (
                <svg
                  key={i}
                  className={`h-5 w-5 ${
                    i < Math.round(ratingAvg)
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground/30"
                  }`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <span className="text-sm font-semibold text-foreground">
              {ratingAvg > 0 ? ratingAvg.toFixed(1) : "0.0"} out of 5
            </span>
            <span className="text-sm text-muted-foreground">
              ({ratingCount} {ratingCount === 1 ? "review" : "reviews"})
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsOpenForm(!isOpenForm)}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
        >
          {isOpenForm ? "Close Review Form" : "Write a Review"}
        </button>
      </div>

      {/* Review submission form */}
      {isOpenForm && (
        <form
          onSubmit={handleSubmit}
          className="my-8 rounded-xl border border-border bg-card/60 p-6 shadow-sm space-y-4 max-w-2xl"
        >
          <h3 className="text-lg font-semibold text-foreground">Write a Review for {productTitle}</h3>

          {formSuccess && (
            <div className="rounded-md bg-emerald-500/10 p-4 border border-emerald-500/20 text-sm text-emerald-600 dark:text-emerald-400">
              {formSuccess}
            </div>
          )}

          {formError && (
            <div className="rounded-md bg-destructive/10 p-4 border border-destructive/20 text-sm text-destructive">
              {formError}
            </div>
          )}

          {/* Honeypot field (hidden from users) */}
          <div className="hidden" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input
              type="text"
              id="website"
              name="website"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Your Rating *</label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setRating(s)}
                  className="p-1 text-amber-400 hover:scale-110 transition-transform"
                >
                  <svg
                    className={`h-6 w-6 ${
                      s <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
                    }`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Your Name *</label>
              <input
                type="text"
                required
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                placeholder="e.g. John Doe"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Email (for verification)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. john@example.com"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">Order Number (optional)</label>
            <input
              type="text"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="e.g. #ORD-1001"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">Review Headline</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Excellent quality and fast shipping"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">Your Review *</label>
            <textarea
              required
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Share what you liked or how this product helped you..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsOpenForm(false)}
              className="rounded-lg border border-input px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Submitting..." : "Submit Review"}
            </button>
          </div>
        </form>
      )}

      {/* Reviews list */}
      <div className="mt-8 divide-y divide-border/60">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No customer reviews yet. Be the first to review this product!
          </div>
        ) : (
          reviews.map((rev) => (
            <article key={rev.id} className="py-6 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center text-amber-400">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <svg
                        key={i}
                        className={`h-4 w-4 ${
                          i < rev.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
                        }`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                  </div>
                  {rev.title && <h4 className="font-semibold text-sm text-foreground">{rev.title}</h4>}
                </div>
                <time className="text-xs text-muted-foreground">
                  {new Date(rev.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </time>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{rev.reviewerName}</span>
                {rev.isVerifiedPurchase && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Verified Purchase
                  </span>
                )}
              </div>

              <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{rev.body}</p>

              {rev.replyText && (
                <div className="mt-3 rounded-lg border-l-2 border-primary bg-muted/40 p-3 text-xs">
                  <span className="font-semibold text-foreground">Store Response: </span>
                  <p className="mt-1 text-muted-foreground">{rev.replyText}</p>
                </div>
              )}
            </article>
          ))
        )}
      </div>

      {/* Pagination */}
      {total > 10 && (
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <span className="text-xs text-muted-foreground">
            Showing {(page - 1) * 10 + 1} to {Math.min(page * 10, total)} of {total} reviews
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page * 10 >= total}
              onClick={() => setPage(page + 1)}
              className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
