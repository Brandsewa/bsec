import { oc } from "@orpc/contract";
import { z } from "zod";

// --- Search Schemas ---
export const StorefrontPrimaryMedia = z.object({
  id: z.string(),
  storageKey: z.string(),
  cfImageId: z.string().nullable(),
  alt: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});
export type StorefrontPrimaryMedia = z.infer<typeof StorefrontPrimaryMedia>;

export const StorefrontSearchItem = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  priceMin: z.number(),
  priceMax: z.number(),
  compareAtPriceMin: z.number().nullable(),
  compareAtPriceMax: z.number().nullable(),
  hasVariants: z.boolean(),
  primaryMedia: StorefrontPrimaryMedia.nullable(),
});
export type StorefrontSearchItem = z.infer<typeof StorefrontSearchItem>;

export const StorefrontSearchInput = z.object({
  query: z.string(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type StorefrontSearchInput = z.infer<typeof StorefrontSearchInput>;

export const StorefrontSearchOutput = z.object({
  items: z.array(StorefrontSearchItem),
  total: z.number(),
});
export type StorefrontSearchOutput = z.infer<typeof StorefrontSearchOutput>;

export const StorefrontSuggestionsInput = z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(10).optional(),
});
export type StorefrontSuggestionsInput = z.infer<typeof StorefrontSuggestionsInput>;

export const StorefrontSuggestionItem = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
});
export type StorefrontSuggestionItem = z.infer<typeof StorefrontSuggestionItem>;

export const StorefrontSuggestionsOutput = z.object({
  suggestions: z.array(StorefrontSuggestionItem),
});
export type StorefrontSuggestionsOutput = z.infer<typeof StorefrontSuggestionsOutput>;

// --- Cart Schemas ---
export const StorefrontCartItem = z.object({
  id: z.string(),
  cartId: z.string().optional(),
  variantId: z.string(),
  quantity: z.number(),
  unitPriceSnapshot: z.number().optional(),
  lineTotal: z.number().optional(),
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
  product: z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
  }),
  variant: z.object({
    id: z.string(),
    sku: z.string().optional(),
    title: z.string(),
    optionValues: z.record(z.string(), z.string()).nullable().optional(),
    price: z.number(),
  }),
  primaryImage: z
    .object({
      mediaId: z.string().optional(),
      id: z.string().optional(),
      storageKey: z.string().optional(),
      alt: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type StorefrontCartItem = z.infer<typeof StorefrontCartItem>;

export const StorefrontCart = z.object({
  id: z.string(),
  token: z.string(),
  currency: z.string(),
  itemCount: z.number(),
  subtotal: z.number(),
  items: z.array(StorefrontCartItem),
  lastActivityAt: z.string().optional(),
  createdAt: z.string().optional(),
});
export type StorefrontCart = z.infer<typeof StorefrontCart>;

export const ShippingRate = z.object({
  id: z.string(),
  name: z.string(),
  amountPaise: z.number(),
  estimatedDays: z.string(),
});
export type ShippingRate = z.infer<typeof ShippingRate>;

export const ShippingEstimateOutput = z.object({
  serviceable: z.boolean(),
  pincode: z.string(),
  rates: z.array(ShippingRate),
});
export type ShippingEstimateOutput = z.infer<typeof ShippingEstimateOutput>;

// --- Newsletter Schemas ---
export const NewsletterSubscribeInput = z.object({
  email: z.string().email(),
  source: z.string().optional(),
});
export type NewsletterSubscribeInput = z.infer<typeof NewsletterSubscribeInput>;

export const NewsletterSubscribeOutput = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type NewsletterSubscribeOutput = z.infer<typeof NewsletterSubscribeOutput>;

// --- Status Schemas ---
export const StatusVerifyPasswordInput = z.object({
  password: z.string(),
});
export type StatusVerifyPasswordInput = z.infer<typeof StatusVerifyPasswordInput>;

export const StatusVerifyPasswordOutput = z.object({
  success: z.boolean(),
  token: z.string().optional(),
});
export type StatusVerifyPasswordOutput = z.infer<typeof StatusVerifyPasswordOutput>;

// --- Storefront Contract ---
export const storefrontContract = {
  search: oc
    .route({ method: "GET", path: "/storefront/search" })
    .input(StorefrontSearchInput)
    .output(StorefrontSearchOutput),

  searchSuggestions: oc
    .route({ method: "GET", path: "/storefront/search/suggestions" })
    .input(StorefrontSuggestionsInput)
    .output(StorefrontSuggestionsOutput),

  cart: {
    get: oc
      .route({ method: "GET", path: "/storefront/cart" })
      .input(z.object({ token: z.string().optional() }))
      .output(StorefrontCart),

    addItem: oc
      .route({ method: "POST", path: "/storefront/cart/items" })
      .input(
        z.object({
          token: z.string().optional(),
          variantId: z.string().uuid(),
          quantity: z.number().int().positive(),
          properties: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .output(StorefrontCart),

    updateItem: oc
      .route({ method: "PATCH", path: "/storefront/cart/items/{itemId}" })
      .input(
        z.object({
          token: z.string(),
          itemId: z.string().uuid(),
          quantity: z.number().int().min(0),
        }),
      )
      .output(StorefrontCart),

    removeItem: oc
      .route({ method: "DELETE", path: "/storefront/cart/items/{itemId}" })
      .input(
        z.object({
          token: z.string(),
          itemId: z.string().uuid(),
        }),
      )
      .output(StorefrontCart),

    clear: oc
      .route({ method: "POST", path: "/storefront/cart/clear" })
      .input(
        z.object({
          token: z.string(),
        }),
      )
      .output(StorefrontCart),

    estimateShipping: oc
      .route({ method: "POST", path: "/storefront/cart/estimate-shipping" })
      .input(
        z.object({
          token: z.string(),
          pincode: z.string(),
        }),
      )
      .output(ShippingEstimateOutput),
  },

  newsletter: {
    subscribe: oc
      .route({ method: "POST", path: "/storefront/newsletter/subscribe" })
      .input(NewsletterSubscribeInput)
      .output(NewsletterSubscribeOutput),
  },

  status: {
    verifyPassword: oc
      .route({ method: "POST", path: "/storefront/status/verify-password" })
      .input(StatusVerifyPasswordInput)
      .output(StatusVerifyPasswordOutput),
  },

  quotes: {
    submit: oc
      .route({ method: "POST", path: "/storefront/quotes/submit" })
      .input(
        z.object({
          productId: z.string().uuid(),
          variantId: z.string().uuid(),
          quantity: z.number().int().min(1).max(100_000).default(1),
          name: z.string().trim().min(1).max(100),
          email: z.string().trim().email().max(255),
          phone: z.string().trim().min(10).max(20),
          company: z.string().trim().max(100).optional(),
          message: z.string().trim().max(2000).optional(),
        }),
      )
      .output(
        z.object({
          success: z.boolean(),
          quoteNumber: z.string(),
          message: z.string(),
        }),
      ),
  },

  reviews: {
    list: oc
      .route({ method: "GET", path: "/storefront/products/{productId}/reviews" })
      .input(
        z.object({
          productId: z.string().uuid(),
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(50).default(10),
        }),
      )
      .output(
        z.object({
          items: z.array(
            z.object({
              id: z.string().uuid(),
              reviewerName: z.string(),
              rating: z.number().int().min(1).max(5),
              title: z.string().nullable().optional(),
              body: z.string(),
              replyText: z.string().nullable().optional(),
              repliedAt: z.string().nullable().optional(),
              isVerifiedPurchase: z.boolean(),
              createdAt: z.string(),
            }),
          ),
          total: z.number().int(),
          ratingAvg: z.number(),
          ratingCount: z.number().int(),
          ratingDistribution: z.object({
            5: z.number().int(),
            4: z.number().int(),
            3: z.number().int(),
            2: z.number().int(),
            1: z.number().int(),
          }),
        }),
      ),

    submit: oc
      .route({ method: "POST", path: "/storefront/products/{productId}/reviews" })
      .input(
        z.object({
          productId: z.string().uuid(),
          variantId: z.string().uuid().optional(),
          reviewerName: z.string().trim().min(1).max(80),
          email: z.string().trim().email().max(255).optional(),
          rating: z.number().int().min(1).max(5),
          title: z.string().trim().max(100).optional(),
          body: z.string().trim().min(1).max(1000),
          orderNumber: z.string().trim().max(50).optional(),
          honeypot: z.string().max(0).optional(), // Must be empty
        }),
      )
      .output(
        z.object({
          success: z.boolean(),
          status: z.enum(["published", "on_hold"]),
          message: z.string(),
        }),
      ),
  },
};
export type StorefrontContract = typeof storefrontContract;

