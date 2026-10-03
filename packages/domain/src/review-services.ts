import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import { invalidateCache } from "./cache-invalidation.ts";

export interface ListReviewsQuery {
  productId?: string | undefined;
  status?: "all" | "published" | "on_hold" | "replied" | "awaiting_reply" | undefined;
  rating?: number | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface SubmitReviewInput {
  productId: string;
  variantId?: string | undefined;
  reviewerName: string;
  email?: string | undefined;
  rating: number;
  title?: string | undefined;
  body: string;
  orderNumber?: string | undefined;
  honeypot?: string | undefined;
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
 * Enforces verified purchase check (delivered order item), honeypot, plain text sanitization, and auto-publish setting.
 */
export async function submitProductReview(
  rt: Runtime,
  tenantId: string,
  input: SubmitReviewInput,
  customerId?: string | undefined,
) {
  // 1. Honeypot check: bot prevention
  if (input.honeypot && input.honeypot.trim().length > 0) {
    // Silently drop bot submission
    return {
      success: true,
      status: "on_hold" as const,
      message: "Thank you! Your review has been submitted for moderation.",
    };
  }

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

  return withTenant(rt._db.db, tenantId, async (tx) => {
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
    let matchedCustomerId: string | null = customerId ?? null;
    let matchedOrderItemId: string | null = null;

    if (!matchedCustomerId && input.email) {
      const [customerRow] = await tx
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.email, input.email.trim().toLowerCase())))
        .limit(1);
      if (customerRow) {
        matchedCustomerId = customerRow.id;
      }
    }

    // Find delivered order item matching this customer or order number
    if (matchedCustomerId || input.orderNumber || input.email) {
      const orderConditions: SQL[] = [eq(schema.orders.tenantId, tenantId)];
      if (matchedCustomerId) {
        orderConditions.push(eq(schema.orders.customerId, matchedCustomerId));
      } else if (input.email) {
        orderConditions.push(eq(schema.orders.email, input.email.trim().toLowerCase()));
      }
      if (input.orderNumber) {
        orderConditions.push(eq(schema.orders.number, input.orderNumber.trim()));
      }

      // Check delivered orders containing this product
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
            ...orderConditions,
            eq(schema.orders.fulfillmentStatus, "delivered"),
            eq(schema.variants.productId, input.productId),
          ),
        )
        .limit(1);

      if (deliveredOrders.length > 0 && deliveredOrders[0]) {
        matchedOrderItemId = deliveredOrders[0].orderItemId;
      }
    }

    // 5. Check if review already exists for this customer/email & product
    if (matchedCustomerId) {
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
      await invalidateCache(rt, tenantId, { type: "review_updated", productId: input.productId });
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

    if (query.status && query.status !== "all") {
      if (query.status === "published" || query.status === "on_hold") {
        conditions.push(eq(schema.reviews.status, query.status));
      } else if (query.status === "replied") {
        conditions.push(sql`${schema.reviews.replyText} IS NOT NULL AND ${schema.reviews.replyText} != ''`);
      } else if (query.status === "awaiting_reply") {
        conditions.push(sql`(${schema.reviews.replyText} IS NULL OR ${schema.reviews.replyText} = '')`);
      }
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
        status: review.status as "published" | "on_hold",
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
      status: review.status as "published" | "on_hold",
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
