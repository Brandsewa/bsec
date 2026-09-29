import { and, eq } from "drizzle-orm";
import { type Db, wishlistItems, withTenant } from "@bs/db";

export interface WishlistItemRecord {
  id: string;
  customerId: string;
  variantId: string;
  productId: string;
  createdAt: Date;
}

export async function getWishlist(
  db: Db,
  tenantId: string,
  customerId: string,
): Promise<WishlistItemRecord[]> {
  return await withTenant(db, tenantId, async (tx) => {
    return await tx
      .select()
      .from(wishlistItems)
      .where(
        and(
          eq(wishlistItems.tenantId, tenantId),
          eq(wishlistItems.customerId, customerId),
        ),
      );
  });
}

export async function addToWishlist(
  db: Db,
  tenantId: string,
  customerId: string,
  variantId: string,
  productId: string,
): Promise<WishlistItemRecord> {
  return await withTenant(db, tenantId, async (tx) => {
    const [item] = await tx
      .insert(wishlistItems)
      .values({
        tenantId,
        customerId,
        variantId,
        productId,
      })
      .onConflictDoNothing()
      .returning();

    if (item) return item;

    const [existing] = await tx
      .select()
      .from(wishlistItems)
      .where(
        and(
          eq(wishlistItems.tenantId, tenantId),
          eq(wishlistItems.customerId, customerId),
          eq(wishlistItems.variantId, variantId),
        ),
      );
    if (!existing) {
      throw new Error("Failed to add or retrieve wishlist item");
    }
    return existing;
  });
}

export async function removeFromWishlist(
  db: Db,
  tenantId: string,
  customerId: string,
  variantId: string,
): Promise<boolean> {
  return await withTenant(db, tenantId, async (tx) => {
    const res = await tx
      .delete(wishlistItems)
      .where(
        and(
          eq(wishlistItems.tenantId, tenantId),
          eq(wishlistItems.customerId, customerId),
          eq(wishlistItems.variantId, variantId),
        ),
      )
      .returning({ id: wishlistItems.id });

    return res.length > 0;
  });
}
