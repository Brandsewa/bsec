import React from "react";
import Link from "next/link";
import { getCustomerReviews } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";
import { RelativeTime } from "@bs/ui";

export default async function AccountReviewsPage() {
  const ctx = await accountContext();
  if (!ctx) return null;
  const reviews = await getCustomerReviews(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id);
  if (reviews.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-8 text-center" data-testid="no-reviews">
        <p className="text-sm text-[var(--muted-foreground)]">You have not reviewed any products yet. Reviews you write on a product page show up here.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-3" data-testid="reviews-list">
      {reviews.map((r) => (
        <li key={r.id} className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/products/${r.productSlug}`} className="text-sm font-semibold hover:opacity-70 transition-opacity">
              {r.productTitle}
            </Link>
            <span className="text-xs text-[var(--muted-foreground)]">
              {r.status === "published" ? "Published" : "Awaiting approval"} · <RelativeTime date={r.createdAt} />
            </span>
          </div>
          <p className="mt-1 text-sm" aria-label={`${r.rating} out of 5`}>
            {"★".repeat(r.rating)}
            <span className="text-[var(--muted-foreground)]">{"★".repeat(5 - r.rating)}</span>
          </p>
          {r.title && <p className="mt-1 text-sm font-medium">{r.title}</p>}
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{r.body}</p>
        </li>
      ))}
    </ul>
  );
}
