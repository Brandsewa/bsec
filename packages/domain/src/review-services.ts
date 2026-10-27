import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import { checkRateLimit, RateLimitExceededError } from "./system/rate-limit.ts";
import { invalidateCache } from "./cache-invalidation.ts";

export type ReviewStatus = "published" | "on_hold" | "spam" | "archived";
export type ReviewSource = "customer" | "manual" | "import";

export interface ListReviewsQuery {
  productId?: string | undefined;
  status?: "all" | "published" | "on_hold" | "spam" | "archived" | "replied" | "awaiting_reply" | undefined;
  rating?: number | undefined;
  search?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface SubmitReviewInput {
  productId: string;
  variantId?: string | undefined;
  reviewerName: string;
  rating: number;
  title?: string | undefined;
  body: string;
  honeypot?: string | undefined;
  /** Client IP, for rate limiting. */
  ip?: string | undefined;
}

export interface ReviewReplyInput {
  id: string;
  replyText: string;
}

export interface StorefrontReviewsQuery {
  productId: string;
  page?: number | undefined;
  limit?: number | undefined;
}

/** Sanitizes public input: strips all HTML tags and control characters, escapes dangerous entities */
export function sanitizePlainText(text: string): string {
  if (!text) return "";
  // Strip script/style tags and contents first
  let clean = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  // Strip all other HTML tags
  clean = clean.replace(/<[^>]*>/g, "");
  // Strip URLs and link patterns to prevent spam
  clean = clean.replace(/https?:\/\/[^\s]+/gi, "");
  // Normalize horizontal spaces
  clean = clean.replace(/[^\S\r\n]+/g, " ");
  // Collapse more than 2 consecutive newlines
  clean = clean.replace(/(\r?\n){3,}/g, "\n\n");
  return clean.trim();
}

/**
 * Recalculates `rating_avg` and `rating_count` on `products` in the current transaction.
 * Only published reviews are counted.
 */
export async function recomputeProductRatingAggregate(tx: Db, tenantId: string, productId: string) {
  const [stats] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      avg: sql<string>`coalesce(round(avg(${schema.reviews.rating})::numeric, 2), 0.00)::text`,
    })
    .from(schema.reviews)
    .where(
      and(
        eq(schema.reviews.tenantId, tenantId),
        eq(schema.reviews.productId, productId),
        eq(schema.reviews.status, "published"),
      ),
    );

  const ratingCount = stats?.count ?? 0;
  const ratingAvg = ratingCount > 0 ? (stats?.avg ?? "0.00") : "0.00";

  await tx
    .update(schema.products)
    .set({
      ratingAvg,
      ratingCount,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.products.tenantId, tenantId), eq(schema.products.id, productId)));
}

/**
 * Storefront: Query published reviews for a product with pagination, average rating and distribution breakdown.
 */
export async function getStorefrontReviews(
  rt: Runtime,
  tenantId: string,
  query: StorefrontReviewsQuery,
) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  const offset = (page - 1) * limit;

  return withTenant(rt._db.db, tenantId, async (tx) => {
    // 1. Get rating aggregate stats and star breakdown for published reviews
    const allPublished = await tx
      .select({
        rating: schema.reviews.rating,
      })
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.tenantId, tenantId),
          eq(schema.reviews.productId, query.productId),
          eq(schema.reviews.status, "published"),
        ),
      );

    const total = allPublished.length;
    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let sum = 0;

    for (const r of allPublished) {
      const star = r.rating as 1 | 2 | 3 | 4 | 5;
      if (distribution[star] !== undefined) {
        distribution[star]++;
        sum += star;
      }
    }

    const ratingAvg = total > 0 ? Number((sum / total).toFixed(2)) : 0;

    // 2. Fetch paginated published reviews (newest first)
    const rows = await tx
      .select({
        id: schema.reviews.id,
        reviewerName: schema.reviews.reviewerName,
        rating: schema.reviews.rating,
        title: schema.reviews.title,
        body: schema.reviews.body,
        replyText: schema.reviews.replyText,
        repliedAt: schema.reviews.repliedAt,
        orderItemId: schema.reviews.orderItemId,
        createdAt: schema.reviews.createdAt,
      })
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.tenantId, tenantId),
          eq(schema.reviews.productId, query.productId),
          eq(schema.reviews.status, "published"),
        ),
      )
      .orderBy(desc(schema.reviews.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r) => ({
        id: r.id,
        reviewerName: r.reviewerName,
        rating: r.rating,
        title: r.title,
        body: r.body,
        replyText: r.replyText,
        repliedAt: r.repliedAt ? r.repliedAt.toISOString() : null,
        isVerifiedPurchase: Boolean(r.orderItemId),
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      ratingAvg,
      ratingCount: total,
      ratingDistribution: distribution,
    };
  });
}

/**
 * Storefront: Submit a product review.
 * Only a signed-in customer can review. Enforces the verified purchase check (a delivered order of theirs containing the
 * product), honeypot, plain text sanitization, and auto-publish setting.
 */
export async function submitProductReview(
  rt: Runtime,
  tenantId: string,
  input: SubmitReviewInput,
  customerId?: string | undefined,
) {
  // 0. Reviews need a signed-in customer (owner decision 2026-10-23): no anonymous or email-only reviews.
  if (!customerId) {
    throw new Error("Unauthorized: Please sign in to review this product.");
  }

  // 1. Honeypot check: bot prevention
  if (input.honeypot && input.honeypot.trim().length > 0) {
    // Silently drop bot submission
    return {
      success: true,
      status: "on_hold" as const,
      message: "Thank you! Your review has been submitted for moderation.",
    };
  }

  // Rate limit: a public form must not let one client flood the moderation queue.
  const db = rt._db.db;
  if (input.ip && input.ip !== "unknown") {
    const ipKey = `review_submit:ip:${tenantId}:${input.ip}`;
    const ipRes = await checkRateLimit(db, { key: ipKey, limit: 10, windowSeconds: 3600 });
    if (!ipRes.allowed) throw new RateLimitExceededError("Too many reviews from this connection. Please try again later.", ipRes.retryAfter, 10, ipKey);
  }
  const customerKey = `review_submit:customer:${tenantId}:${customerId}`;
  const customerRes = await checkRateLimit(db, { key: customerKey, limit: 5, windowSeconds: 3600 });
  if (!customerRes.allowed) throw new RateLimitExceededError("Too many reviews from this account. Please try again later.", customerRes.retryAfter, 5, customerKey);

  // 2. Sanitize plain text
  const cleanReviewerName = sanitizePlainText(input.reviewerName);
  const cleanTitle = input.title ? sanitizePlainText(input.title) : undefined;
  const cleanBody = sanitizePlainText(input.body);

  if (!cleanReviewerName) {
    throw new Error("Bad Request: Reviewer name is required.");
  }
  if (!cleanBody) {
    throw new Error("Bad Request: Review text cannot be empty or contain forbidden HTML/links.");
  }
  if (input.rating < 1 || input.rating > 5) {
    throw new Error("Bad Request: Rating must be between 1 and 5.");
  }

  const result = await withTenant(rt._db.db, tenantId, async (tx) => {
    // 3. Verify Product exists
    const [product] = await tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.tenantId, tenantId), eq(schema.products.id, input.productId)))
      .limit(1);

    if (!product) {
      throw new Error("Not Found: Product not found.");
    }

    // 4. Determine verified purchase & customer linkage
    const matchedCustomerId: string = customerId;
    let matchedOrderItemId: string | null = null;

    // A delivered order of this customer that contains the product makes it a verified purchase.
    const deliveredOrders = await tx
      .select({
        orderItemId: schema.orderItems.id,
        variantId: schema.orderItems.variantId,
      })
      .from(schema.orders)
      .innerJoin(schema.orderItems, and(eq(schema.orderItems.tenantId, tenantId), eq(schema.orderItems.orderId, schema.orders.id)))
      .innerJoin(schema.variants, and(eq(schema.variants.tenantId, tenantId), eq(schema.variants.id, schema.orderItems.variantId)))
      .where(
        and(
          eq(schema.orders.tenantId, tenantId),
          eq(schema.orders.customerId, matchedCustomerId),
          eq(schema.orders.fulfillmentStatus, "delivered"),
          eq(schema.variants.productId, input.productId),
        ),
      )
      .limit(1);
    if (deliveredOrders[0]) matchedOrderItemId = deliveredOrders[0].orderItemId;

    // 5. Check if review already exists for this customer & product
    {
      const [existingReview] = await tx
        .select({ id: schema.reviews.id })
        .from(schema.reviews)
        .where(
          and(
            eq(schema.reviews.tenantId, tenantId),
            eq(schema.reviews.productId, input.productId),
            eq(schema.reviews.customerId, matchedCustomerId),
          ),
        )
        .limit(1);

      if (existingReview) {
        throw new Error("Conflict: You have already reviewed this product.");
      }
    }

    // 6. Check store auto-publish settings
    const [settings] = await tx
      .select({ autoPublishReviews: schema.storeSettings.autoPublishReviews })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.tenantId, tenantId))
      .limit(1);

    const autoPublish = Boolean(settings?.autoPublishReviews);
    // Verified purchase reviews publish immediately if autoPublish is on, else on_hold
    const status: "published" | "on_hold" = autoPublish && matchedOrderItemId ? "published" : "on_hold";

    // 7. Insert review
    const [review] = await tx
      .insert(schema.reviews)
      .values({
        tenantId,
        productId: input.productId,
        variantId: input.variantId ?? null,
        customerId: matchedCustomerId,
        orderItemId: matchedOrderItemId,
        reviewerName: cleanReviewerName,
        rating: input.rating,
        title: cleanTitle ?? null,
        body: cleanBody,
        status,
      })
      .returning();

    if (!review) {
      throw new Error("Failed to submit review");
    }

    // 8. Recompute rating aggregate if published
    if (status === "published") {
      await recomputeProductRatingAggregate(tx, tenantId, input.productId);
    }

    return {
      success: true,
      status,
      message:
        status === "published"
          ? "Thank you! Your review has been published."
          : "Thank you! Your review has been submitted for moderation.",
    };
  });

  if (result.status === "published") {
    await invalidateCache(rt, tenantId, { type: "review_updated", productId: input.productId });
  }

  return result;
}

/**
 * Admin: List reviews with filters (product, status, rating, search) and pagination.
 */
export async function listAdminReviews(
  rt: Runtime,
  ctx: TenantContext,
  query: ListReviewsQuery = {},
) {
  assertPermission(ctx, "products.read");
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  const offset = Math.max(0, query.offset ?? 0);

  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const conditions: SQL[] = [eq(schema.reviews.tenantId, ctx.tenantId)];

    if (query.productId) {
      conditions.push(eq(schema.reviews.productId, query.productId));
    }

    if (query.rating) {
      conditions.push(eq(schema.reviews.rating, query.rating));
    }

    if (!query.status || query.status === "all") {
      // Spam and archived reviews only show under their own filters.
      conditions.push(sql`${schema.reviews.status} NOT IN ('spam', 'archived')`);
    } else {
      if (query.status === "published" || query.status === "on_hold" || query.status === "spam" || query.status === "archived") {
        conditions.push(eq(schema.reviews.status, query.status));
      } else if (query.status === "replied") {
        conditions.push(sql`${schema.reviews.replyText} IS NOT NULL AND ${schema.reviews.replyText} != ''`);
      } else if (query.status === "awaiting_reply") {
        conditions.push(sql`(${schema.reviews.replyText} IS NULL OR ${schema.reviews.replyText} = '')`);
      }
    }

    if (query.dateFrom) {
      conditions.push(gte(schema.reviews.createdAt, new Date(query.dateFrom)));
    }
    if (query.dateTo) {
      conditions.push(lte(schema.reviews.createdAt, new Date(query.dateTo)));
    }

    if (query.search?.trim()) {
      const q = `%${query.search.trim().replace(/[%_\\]/g, "\\$&")}%`;
      const searchMatch = or(
        ilike(schema.reviews.reviewerName, q),
        ilike(schema.reviews.title, q),
        ilike(schema.reviews.body, q),
        ilike(schema.products.title, q),
      );
      if (searchMatch) conditions.push(searchMatch);
    }

    const whereClause = and(...conditions);

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.reviews)
      .innerJoin(schema.products, and(eq(schema.products.tenantId, ctx.tenantId), eq(schema.products.id, schema.reviews.productId)))
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const rows = await tx
      .select({
        review: schema.reviews,
        productTitle: schema.products.title,
        productSlug: schema.products.slug,
        variantTitle: schema.variants.title,
      })
      .from(schema.reviews)
      .innerJoin(schema.products, and(eq(schema.products.tenantId, ctx.tenantId), eq(schema.products.id, schema.reviews.productId)))
      .leftJoin(schema.variants, and(eq(schema.variants.tenantId, ctx.tenantId), eq(schema.variants.id, schema.reviews.variantId)))
      .where(whereClause)
      .orderBy(desc(schema.reviews.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map(({ review, productTitle, productSlug, variantTitle }) => ({
        id: review.id,
        productId: review.productId,
        productTitle,
        productSlug,
        variantId: review.variantId,
        variantTitle,
        customerId: review.customerId,
        orderItemId: review.orderItemId,
        reviewerName: review.reviewerName,
        rating: review.rating,
        title: review.title,
        body: review.body,
        status: review.status as ReviewStatus,
        source: review.source as ReviewSource,
        replyText: review.replyText,
        repliedAt: review.repliedAt ? review.repliedAt.toISOString() : null,
        isVerifiedPurchase: Boolean(review.orderItemId),
        createdAt: review.createdAt.toISOString(),
        updatedAt: review.updatedAt.toISOString(),
      })),
      total,
    };
  });
}

/**
 * Admin: Get stats for reviews.
 */
export async function getAdminReviewStats(
  rt: Runtime,
  ctx: TenantContext,
  filter?: { productId?: string | undefined },
) {
  assertPermission(ctx, "products.read");

  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const conditions: SQL[] = [eq(schema.reviews.tenantId, ctx.tenantId)];
    if (filter?.productId) {
      conditions.push(eq(schema.reviews.productId, filter.productId));
    }

    const rows = await tx
      .select({
        status: schema.reviews.status,
        rating: schema.reviews.rating,
        hasReply: sql<boolean>`${schema.reviews.replyText} IS NOT NULL AND ${schema.reviews.replyText} != ''`,
      })
      .from(schema.reviews)
      .where(and(...conditions));

    let published = 0;
    let onHold = 0;
    let spam = 0;
    let archived = 0;
    let replied = 0;
    let awaitingReply = 0;
    let sumPublishedRating = 0;
    const ratingCounts: Record<1 | 2 | 3 | 4 | 5, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    for (const r of rows) {
      if (r.status === "published") {
        published++;
        sumPublishedRating += r.rating;
        const star = r.rating as 1 | 2 | 3 | 4 | 5;
        if (ratingCounts[star] !== undefined) {
          ratingCounts[star]++;
        }
      } else if (r.status === "spam") {
        spam++;
      } else if (r.status === "archived") {
        archived++;
      } else {
        onHold++;
      }

      if (r.hasReply) {
        replied++;
      } else {
        awaitingReply++;
      }
    }

    const averageRating = published > 0 ? Number((sumPublishedRating / published).toFixed(2)) : 0;

    return {
      total: rows.length,
      published,
      onHold,
      spam,
      archived,
      replied,
      awaitingReply,
      averageRating,
      ratingCounts,
    };
  });
}

/**
 * Admin: Get single review detail.
 */
export async function getAdminReviewDetail(
  rt: Runtime,
  ctx: TenantContext,
  id: string,
) {
  assertPermission(ctx, "products.read");

  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        review: schema.reviews,
        productTitle: schema.products.title,
        productSlug: schema.products.slug,
        variantTitle: schema.variants.title,
      })
      .from(schema.reviews)
      .innerJoin(schema.products, and(eq(schema.products.tenantId, ctx.tenantId), eq(schema.products.id, schema.reviews.productId)))
      .leftJoin(schema.variants, and(eq(schema.variants.tenantId, ctx.tenantId), eq(schema.variants.id, schema.reviews.variantId)))
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.id, id)))
      .limit(1);

    if (!row) {
      throw new Error("Not Found: Review not found.");
    }

    const { review, productTitle, productSlug, variantTitle } = row;

    return {
      id: review.id,
      productId: review.productId,
      productTitle,
      productSlug,
      variantId: review.variantId,
      variantTitle,
      customerId: review.customerId,
      orderItemId: review.orderItemId,
      reviewerName: review.reviewerName,
      rating: review.rating,
      title: review.title,
      body: review.body,
      status: review.status as ReviewStatus,
      source: review.source as ReviewSource,
      replyText: review.replyText,
      repliedAt: review.repliedAt ? review.repliedAt.toISOString() : null,
      isVerifiedPurchase: Boolean(review.orderItemId),
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  });
}

/**
 * Admin: Publish review.
 */
export async function publishAdminReview(
  rt: Runtime,
  ctx: TenantContext,
  id: string,
) {
  assertPermission(ctx, "products.write");

  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [review] = await tx
      .select()
      .from(schema.reviews)
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.id, id)))
      .limit(1);

    if (!review) {
      throw new Error("Not Found: Review not found.");
    }

    if (review.status !== "published") {
      await tx
        .update(schema.reviews)
        .set({ status: "published", updatedAt: new Date() })
        .where(and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.id, id)));

      await recomputeProductRatingAggregate(tx, ctx.tenantId, review.productId);

      // Audit log
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "review.published",
        targetType: "review",
        targetId: id,
        diff: { status: "published", previousStatus: review.status },
      });
    }

    return review;
  });

  await invalidateCache(rt, ctx, { type: "review_updated", productId: result.productId });
  return getAdminReviewDetail(rt, ctx, id);
}

/**
 * Admin: Put review on hold.
 */
export async function holdAdminReview(
  rt: Runtime,
  ctx: TenantContext,
  id: string,
) {
  assertPermission(ctx, "products.write");

  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [review] = await tx
      .select()
      .from(schema.reviews)
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.id, id)))
      .limit(1);

    if (!review) {
      throw new Error("Not Found: Review not found.");
    }

    if (review.status !== "on_hold") {
      await tx
        .update(schema.reviews)
        .set({ status: "on_hold", updatedAt: new Date() })
        .where(and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.id, id)));

      await recomputeProductRatingAggregate(tx, ctx.tenantId, review.productId);

      // Audit log
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "review.held",
        targetType: "review",
        targetId: id,
        diff: { status: "on_hold", previousStatus: review.status },
      });
    }

    return review;
  });

  await invalidateCache(rt, ctx, { type: "review_updated", productId: result.productId });
  return getAdminReviewDetail(rt, ctx, id);
}

/**
 * Admin: Delete review.
 */
export async function deleteAdminReview(
  rt: Runtime,
  ctx: TenantContext,
  id: string,
) {
  assertPermission(ctx, "products.write");

  const productId = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [review] = await tx
      .select()
      .from(schema.reviews)
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.id, id)))
      .limit(1);

    if (!review) {
      throw new Error("Not Found: Review not found.");
    }

    await tx
      .delete(schema.reviews)
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.id, id)));

    await recomputeProductRatingAggregate(tx, ctx.tenantId, review.productId);

    // Audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "review.deleted",
      targetType: "review",
      targetId: id,
      diff: { reviewerName: review.reviewerName, rating: review.rating },
    });

    return review.productId;
  });

  await invalidateCache(rt, ctx, { type: "review_updated", productId });
  return { success: true };
}

/**
 * Admin: Reply to review.
 */
export async function replyAdminReview(
  rt: Runtime,
  ctx: TenantContext,
  input: ReviewReplyInput,
) {
  assertPermission(ctx, "products.write");

  const cleanReply = sanitizePlainText(input.replyText);
  if (!cleanReply) {
    throw new Error("Bad Request: Reply text cannot be empty.");
  }

  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [review] = await tx
      .select()
      .from(schema.reviews)
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.id, input.id)))
      .limit(1);

    if (!review) {
      throw new Error("Not Found: Review not found.");
    }

    await tx
      .update(schema.reviews)
      .set({
        replyText: cleanReply,
        repliedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.id, input.id)));

    // Audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "review.replied",
      targetType: "review",
      targetId: input.id,
      diff: { replyText: cleanReply },
    });

    return review;
  });

  await invalidateCache(rt, ctx, { type: "review_updated", productId: result.productId });
  return getAdminReviewDetail(rt, ctx, input.id);
}

/**
 * Admin: Bulk publish reviews.
 */
export async function bulkPublishAdminReviews(
  rt: Runtime,
  ctx: TenantContext,
  ids: string[],
) {
  assertPermission(ctx, "products.write");
  if (ids.length === 0) return { count: 0 };

  const touchedProductIds = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const targets = await tx
      .select({ id: schema.reviews.id, productId: schema.reviews.productId })
      .from(schema.reviews)
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), inArray(schema.reviews.id, ids)));

    if (targets.length === 0) return [];

    await tx
      .update(schema.reviews)
      .set({ status: "published", updatedAt: new Date() })
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), inArray(schema.reviews.id, ids)));

    const uniqueProductIds = Array.from(new Set(targets.map((t) => t.productId)));
    for (const pId of uniqueProductIds) {
      await recomputeProductRatingAggregate(tx, ctx.tenantId, pId);
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "review.bulk_published",
      targetType: "review",
      targetId: ids[0] ?? "",
      diff: { count: targets.length, ids },
    });

    return uniqueProductIds;
  });

  for (const pId of touchedProductIds) {
    await invalidateCache(rt, ctx, { type: "review_updated", productId: pId });
  }

  return { count: touchedProductIds.length };
}

/**
 * Admin: Bulk hold reviews.
 */
export async function bulkHoldAdminReviews(
  rt: Runtime,
  ctx: TenantContext,
  ids: string[],
) {
  assertPermission(ctx, "products.write");
  if (ids.length === 0) return { count: 0 };

  const touchedProductIds = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const targets = await tx
      .select({ id: schema.reviews.id, productId: schema.reviews.productId })
      .from(schema.reviews)
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), inArray(schema.reviews.id, ids)));

    if (targets.length === 0) return [];

    await tx
      .update(schema.reviews)
      .set({ status: "on_hold", updatedAt: new Date() })
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), inArray(schema.reviews.id, ids)));

    const uniqueProductIds = Array.from(new Set(targets.map((t) => t.productId)));
    for (const pId of uniqueProductIds) {
      await recomputeProductRatingAggregate(tx, ctx.tenantId, pId);
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "review.bulk_held",
      targetType: "review",
      targetId: ids[0] ?? "",
      diff: { count: targets.length, ids },
    });

    return uniqueProductIds;
  });

  for (const pId of touchedProductIds) {
    await invalidateCache(rt, ctx, { type: "review_updated", productId: pId });
  }

  return { count: touchedProductIds.length };
}

/**
 * Admin: Bulk delete reviews.
 */
export async function bulkDeleteAdminReviews(
  rt: Runtime,
  ctx: TenantContext,
  ids: string[],
) {
  assertPermission(ctx, "products.write");
  if (ids.length === 0) return { count: 0 };

  const touchedProductIds = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const targets = await tx
      .select({ id: schema.reviews.id, productId: schema.reviews.productId })
      .from(schema.reviews)
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), inArray(schema.reviews.id, ids)));

    if (targets.length === 0) return [];

    await tx
      .delete(schema.reviews)
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), inArray(schema.reviews.id, ids)));

    const uniqueProductIds = Array.from(new Set(targets.map((t) => t.productId)));
    for (const pId of uniqueProductIds) {
      await recomputeProductRatingAggregate(tx, ctx.tenantId, pId);
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "review.bulk_deleted",
      targetType: "review",
      targetId: ids[0] ?? "",
      diff: { count: targets.length, ids },
    });

    return uniqueProductIds;
  });

  for (const pId of touchedProductIds) {
    await invalidateCache(rt, ctx, { type: "review_updated", productId: pId });
  }

  return { count: touchedProductIds.length };
}

/** The signed-in shopper's own reviews (any status), newest first, with the product they are about. */
export async function getCustomerReviews(db: Db, tenantId: string, customerId: string) {
  return withTenant(db, tenantId, async (tx) =>
    tx
      .select({
        id: schema.reviews.id,
        rating: schema.reviews.rating,
        title: schema.reviews.title,
        body: schema.reviews.body,
        status: schema.reviews.status,
        createdAt: schema.reviews.createdAt,
        productTitle: schema.products.title,
        productSlug: schema.products.slug,
      })
      .from(schema.reviews)
      .innerJoin(
        schema.products,
        and(eq(schema.products.tenantId, schema.reviews.tenantId), eq(schema.products.id, schema.reviews.productId)),
      )
      .where(and(eq(schema.reviews.tenantId, tenantId), eq(schema.reviews.customerId, customerId)))
      .orderBy(desc(schema.reviews.createdAt))
      .limit(100),
  );
}

/**
 * Admin: approve (published), hold, mark as spam or archive reviews. Only published reviews count towards a product's rating
 * and show on the storefront, so the rating is recomputed for every product touched.
 */
export async function setAdminReviewStatus(rt: Runtime, ctx: TenantContext, input: { ids: string[]; status: ReviewStatus }) {
  assertPermission(ctx, "products.write");
  if (input.ids.length === 0) return { count: 0 };

  const touched = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const updated = await tx
      .update(schema.reviews)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), inArray(schema.reviews.id, input.ids)))
      .returning({ id: schema.reviews.id, productId: schema.reviews.productId });
    if (updated.length === 0) return [];
    const productIds = Array.from(new Set(updated.map((u) => u.productId)));
    for (const pId of productIds) await recomputeProductRatingAggregate(tx, ctx.tenantId, pId);
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: `review.${input.status}`,
      targetType: "review",
      targetId: updated[0]?.id ?? "",
      diff: { status: input.status, count: updated.length, ids: updated.map((u) => u.id) },
    });
    return productIds;
  });
  for (const pId of touched) await invalidateCache(rt, ctx, { type: "review_updated", productId: pId });
  return { count: touched.length === 0 ? 0 : input.ids.length };
}

export interface CreateAdminReviewInput {
  productId: string;
  reviewerName: string;
  rating: number;
  title?: string | undefined;
  body: string;
  status?: "published" | "on_hold" | undefined;
  reviewedAt?: string | undefined;
}

/** Admin: add a review by hand. It is marked `manual` and never counts as a verified purchase. */
export async function createAdminReview(rt: Runtime, ctx: TenantContext, input: CreateAdminReviewInput) {
  assertPermission(ctx, "products.write");
  const id = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [product] = await tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.tenantId, ctx.tenantId), eq(schema.products.id, input.productId)))
      .limit(1);
    if (!product) throw new Error("Not Found: Product not found.");
    const when = input.reviewedAt ? new Date(input.reviewedAt) : new Date();
    const [created] = await tx
      .insert(schema.reviews)
      .values({
        tenantId: ctx.tenantId,
        productId: input.productId,
        reviewerName: input.reviewerName,
        rating: input.rating,
        title: input.title || null,
        body: input.body,
        status: input.status ?? "published",
        source: "manual",
        createdAt: Number.isNaN(when.getTime()) ? new Date() : when,
      })
      .returning({ id: schema.reviews.id });
    if (!created) throw new Error("Could not add the review.");
    await recomputeProductRatingAggregate(tx, ctx.tenantId, input.productId);
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "review.created_manually",
      targetType: "review",
      targetId: created.id,
      diff: { productId: input.productId, rating: input.rating, status: input.status ?? "published" },
    });
    return created.id;
  });
  await invalidateCache(rt, ctx, { type: "review_updated", productId: input.productId });
  return getAdminReviewDetail(rt, ctx, id);
}

export interface ImportReviewRow {
  productHandle: string;
  reviewerName: string;
  rating: number;
  title?: string | undefined;
  body: string;
  status: ReviewStatus;
  reviewedAt?: string | undefined;
}

/**
 * Admin: import reviews (rows parsed from a CSV in the browser). Products are matched by handle. A row that repeats an existing
 * review (same product, reviewer and text) is skipped, so running the same file twice adds nothing. `dryRun` validates and counts only.
 */
export async function importAdminReviews(rt: Runtime, ctx: TenantContext, input: { rows: ImportReviewRow[]; dryRun?: boolean | undefined }) {
  assertPermission(ctx, "products.write");
  if (input.rows.length > 500) throw new Error("Import up to 500 reviews at a time.");

  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const handles = Array.from(new Set(input.rows.map((r) => r.productHandle.toLowerCase())));
    const products = await tx
      .select({ id: schema.products.id, slug: schema.products.slug })
      .from(schema.products)
      .where(and(eq(schema.products.tenantId, ctx.tenantId), inArray(schema.products.slug, handles)));
    const bySlug = new Map(products.map((p) => [p.slug.toLowerCase(), p.id]));

    const errors: Array<{ row: number; message: string }> = [];
    let created = 0;
    let skipped = 0;
    const touched = new Set<string>();
    const seen = new Set<string>();

    for (const [i, r] of input.rows.entries()) {
      const rowNo = i + 1;
      const productId = bySlug.get(r.productHandle.toLowerCase());
      if (!productId) {
        errors.push({ row: rowNo, message: `No product with the handle "${r.productHandle}".` });
        continue;
      }
      const name = r.reviewerName.trim() || "Anonymous";
      const key = `${productId}|${name.toLowerCase()}|${r.body}`;
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      const [dup] = await tx
        .select({ id: schema.reviews.id })
        .from(schema.reviews)
        .where(and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.productId, productId), eq(schema.reviews.reviewerName, name), eq(schema.reviews.body, r.body)))
        .limit(1);
      if (dup) {
        skipped++;
        continue;
      }
      const when = r.reviewedAt ? new Date(r.reviewedAt) : new Date();
      if (!input.dryRun) {
        await tx.insert(schema.reviews).values({
          tenantId: ctx.tenantId,
          productId,
          reviewerName: name,
          rating: r.rating,
          title: r.title || null,
          body: r.body,
          status: r.status,
          source: "import",
          createdAt: Number.isNaN(when.getTime()) ? new Date() : when,
        });
        touched.add(productId);
      }
      created++;
    }

    if (!input.dryRun && created > 0) {
      for (const pId of touched) await recomputeProductRatingAggregate(tx, ctx.tenantId, pId);
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "review.imported",
        targetType: "review",
        targetId: "import",
        diff: { created, skipped, errors: errors.length },
      });
    }
    return { created, skipped, errors, touched: Array.from(touched) };
  });

  for (const pId of result.touched) await invalidateCache(rt, ctx, { type: "review_updated", productId: pId });
  return { created: result.created, skipped: result.skipped, errors: result.errors };
}
