import { oc } from "@orpc/contract";
import { z } from "zod";

// --- Existing M1 Models ---
export const Membership = z.object({
  id: z.string(),
  userId: z.string(),
  roleId: z.string(),
  status: z.string(),
  createdAt: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  roleName: z.string().optional(),
});
export type Membership = z.infer<typeof Membership>;

export const StaffInvitation = z.object({
  id: z.string(),
  email: z.string(),
  roleId: z.string(),
  expiresAt: z.string().optional(),
  /** Only present on the response to creating an invitation: the raw token is shown once and never stored. */
  token: z.string().optional(),
  acceptedAt: z.string().nullable().optional(),
});
export type StaffInvitation = z.infer<typeof StaffInvitation>;

export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const StoreAddress = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().max(12).optional(),
});
export type StoreAddress = z.infer<typeof StoreAddress>;

export const StoreSettings = z.object({
  tenantId: z.string(),
  storeName: z.string(),
  currency: z.string(),
  timezone: z.string(),
  legalName: z.string().nullable().optional(),
  supportEmail: z.string().nullable().optional(),
  supportPhone: z.string().nullable().optional(),
  address: StoreAddress.nullable().optional(),
  orderPrefix: z.string().optional(),
  cod: z.object({ enabled: z.boolean(), feePaise: z.number().int().min(0) }).optional(),
  tax: z
    .object({
      gstin: z.string().nullable(),
      sellerState: z.string().nullable(),
      pricesIncludeTax: z.boolean(),
    })
    .optional(),
});
export type StoreSettings = z.infer<typeof StoreSettings>;

export const FeatureFlagItem = z.object({
  key: z.string(),
  enabled: z.boolean(),
});
export type FeatureFlagItem = z.infer<typeof FeatureFlagItem>;

// --- M2 Catalog Schemas ---
export const ProductVariant = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  sku: z.string(),
  barcode: z.string().nullable().optional(),
  title: z.string(),
  optionValues: z.record(z.string(), z.string()).nullable().optional(),
  price: z.number(), // minor units / paise
  compareAtPrice: z.number().nullable().optional(),
  costPrice: z.number().nullable().optional(),
  weightGrams: z.number().nullable().optional(),
  dimensions: z.record(z.string(), z.unknown()).nullable().optional(),
  trackInventory: z.boolean(),
  allowBackorder: z.boolean(),
  position: z.number(),
  imageMediaId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProductVariant = z.infer<typeof ProductVariant>;

export const ProductOption = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  name: z.string(),
  position: z.number(),
  values: z.array(z.string()),
});
export type ProductOption = z.infer<typeof ProductOption>;

export const ProductMedia = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  mediaId: z.string().uuid(),
  position: z.number(),
  isPrimary: z.boolean(),
  url: z.string().optional(),
});
export type ProductMedia = z.infer<typeof ProductMedia>;

export const Product = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  status: z.enum(["draft", "active", "archived"]),
  descriptionJson: z.unknown().nullable().optional(),
  shortDescription: z.string().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  productType: z.string().nullable().optional(),
  tags: z.array(z.string()),
  seo: z.unknown().nullable().optional(),
  taxClassId: z.string().uuid().nullable().optional(),
  hsn: z.string().nullable().optional(),
  requiresShipping: z.boolean(),
  isFeatured: z.boolean(),
  publishedAt: z.string().nullable().optional(),
  ratingAvg: z.string(),
  ratingCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** List summaries (paise / units). Present on list results. */
  variantCount: z.number().optional(),
  priceMin: z.number().nullable().optional(),
  priceMax: z.number().nullable().optional(),
  stock: z.number().optional(),
});
export type Product = z.infer<typeof Product>;

export const ProductDetail = Product.extend({
  options: z.array(ProductOption),
  variants: z.array(ProductVariant),
  media: z.array(ProductMedia),
});
export type ProductDetail = z.infer<typeof ProductDetail>;

export const Category = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  position: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Category = z.infer<typeof Category>;

export const Collection = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  imageMediaId: z.string().uuid().nullable().optional(),
  isAutomated: z.boolean(),
  rules: z.unknown().nullable().optional(),
  sortOrder: z.string(),
  publishedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Collection = z.infer<typeof Collection>;

export const CollectionDetail = Collection.extend({
  productIds: z.array(z.string().uuid()),
});
export type CollectionDetail = z.infer<typeof CollectionDetail>;

export const Brand = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  logoMediaId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
});
export type Brand = z.infer<typeof Brand>;

// --- M2 Inventory Schemas ---
export const InventoryLevelItem = z.object({
  id: z.string().uuid(),
  variantId: z.string().uuid(),
  locationId: z.string().uuid(),
  onHand: z.number(),
  reserved: z.number(),
  available: z.number(),
  variantSku: z.string().optional(),
  variantTitle: z.string().optional(),
  productTitle: z.string().optional(),
  locationName: z.string().optional(),
});
export type InventoryLevelItem = z.infer<typeof InventoryLevelItem>;

// --- M2 Media Schemas ---
export const MediaItem = z.object({
  id: z.string().uuid(),
  storageKey: z.string(),
  cfImageId: z.string().nullable().optional(),
  mime: z.string(),
  bytes: z.number(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  alt: z.string().nullable().optional(),
  folder: z.string(),
  createdAt: z.string(),
  url: z.string().optional(),
});
export type MediaItem = z.infer<typeof MediaItem>;

export const PresignedUploadResponse = z.object({
  uploadUrl: z.string(),
  storageKey: z.string(),
  headers: z.record(z.string(), z.string()),
});
export type PresignedUploadResponse = z.infer<typeof PresignedUploadResponse>;

// --- M2 Branding Schemas ---
export const BrandSettings = z.object({
  id: z.string().uuid(),
  logoLightMediaId: z.string().uuid().nullable().optional(),
  logoDarkMediaId: z.string().uuid().nullable().optional(),
  logoWidth: z.number(),
  faviconMediaId: z.string().uuid().nullable().optional(),
  socialImageMediaId: z.string().uuid().nullable().optional(),
  fontHeading: z.string(),
  fontBody: z.string(),
  fontSizeScale: z.string(),
  colorSchemeName: z.string(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  accentColor: z.string(),
  backgroundColor: z.string(),
  surfaceColor: z.string(),
  textColor: z.string(),
  colorMode: z.enum(["light", "dark", "auto"]),
  cornerRadius: z.enum(["none", "small", "medium", "large", "full"]),
  buttonStyle: z.enum(["solid", "outline", "pill"]),
  version: z.number(),
  publishedAt: z.string().nullable().optional(),
});
export type BrandSettings = z.infer<typeof BrandSettings>;

// --- M2 Theme & Content Schemas ---
export const Theme = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tokens: z.record(z.string(), z.unknown()),
  settings: z.record(z.string(), z.unknown()),
  isActive: z.boolean(),
  version: z.number(),
});
export type Theme = z.infer<typeof Theme>;

export const PageItem = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  publishedVersionId: z.string().uuid().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PageItem = z.infer<typeof PageItem>;

export const PageDetail = PageItem.extend({
  blocks: z.array(z.unknown()),
  version: z.number(),
});
export type PageDetail = z.infer<typeof PageDetail>;

export type MenuItem = {
  id: string;
  title: string;
  url: string;
  type: "url" | "page" | "collection" | "product" | "category";
  children?: MenuItem[] | undefined;
};

export const MenuItem: z.ZodType<MenuItem> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
    type: z.enum(["url", "page", "collection", "product", "category"]).default("url"),
    children: z.array(MenuItem).optional(),
  }),
);

export const Menu = z.object({
  id: z.string().uuid(),
  name: z.string(),
  handle: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Menu = z.infer<typeof Menu>;

export const MenuDetail = Menu.extend({
  items: z.array(MenuItem),
});
export type MenuDetail = z.infer<typeof MenuDetail>;

// --- Admin oRPC Contract ---
export const PaymentsStatus = z.object({
  razorpay: z.object({
    configured: z.boolean(),
    keyIdHint: z.string().nullable(),
    hasWebhookSecret: z.boolean(),
  }),
  cod: z.object({ enabled: z.boolean(), feePaise: z.number().int() }),
  encryptionKeyConfigured: z.boolean(),
});
export type PaymentsStatus = z.infer<typeof PaymentsStatus>;

export const AdminMeStore = z.object({
  tenantId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  role: z.string(),
  permissions: z.array(z.string()),
});
export const AdminMe = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string(), name: z.string() }),
  stores: z.array(AdminMeStore),
});
export type AdminMe = z.infer<typeof AdminMe>;

export const adminContract = {
  me: {
    get: oc.route({ method: "GET", path: "/admin/me" }).output(AdminMe),
  },
  payments: {
    get: oc.route({ method: "GET", path: "/admin/payments" }).output(PaymentsStatus),
    saveRazorpay: oc
      .route({ method: "PUT", path: "/admin/payments/razorpay" })
      .input(
        z.object({
          keyId: z.string().min(6).max(100),
          keySecret: z.string().min(6).max(200),
          webhookSecret: z.string().min(6).max(200).optional(),
        }),
      )
      .output(PaymentsStatus),
    clearRazorpay: oc.route({ method: "DELETE", path: "/admin/payments/razorpay" }).output(PaymentsStatus),
  },
  memberships: {
    list: oc
      .route({ method: "GET", path: "/admin/memberships" })
      .output(z.array(Membership)),
    roles: oc
      .route({ method: "GET", path: "/admin/memberships/roles" })
      .output(z.array(z.object({ id: z.string(), name: z.string() }))),
    setRole: oc
      .route({ method: "PATCH", path: "/admin/memberships/{id}" })
      .input(z.object({ id: z.string().uuid(), roleId: z.string().uuid() }))
      .output(Membership),
    remove: oc
      .route({ method: "DELETE", path: "/admin/memberships/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ ok: z.literal(true) })),
    invitations: oc
      .route({ method: "GET", path: "/admin/memberships/invitations" })
      .output(z.array(StaffInvitation)),
    revokeInvitation: oc
      .route({ method: "DELETE", path: "/admin/memberships/invitations/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ ok: z.literal(true) })),
    invite: oc
      .route({ method: "POST", path: "/admin/memberships/invite" })
      .input(
        z.object({
          email: z.string().email(),
          roleId: z.string().uuid(),
        }),
      )
      .output(StaffInvitation),
    acceptInvite: oc
      .route({ method: "POST", path: "/admin/accept-invite" })
      .input(
        z.object({
          storeId: z.string().uuid(),
          token: z.string().min(20).max(200),
          name: z.string().min(1).max(120).optional(),
          password: z.string().min(10).max(128).optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true), email: z.string() })),
  },
  settings: {
    get: oc
      .route({ method: "GET", path: "/admin/settings" })
      .output(StoreSettings),
    update: oc
      .route({ method: "PATCH", path: "/admin/settings" })
      .input(
        z.object({
          storeName: z.string().min(1).max(120).optional(),
          currency: z.string().min(3).max(3).optional(),
          timezone: z.string().optional(),
          legalName: z.string().max(200).nullable().optional(),
          supportEmail: z.string().email().nullable().optional(),
          supportPhone: z.string().max(30).nullable().optional(),
          address: StoreAddress.nullable().optional(),
          orderPrefix: z.string().max(10).optional(),
          cod: z.object({ enabled: z.boolean(), feePaise: z.number().int().min(0).max(1_000_000) }).optional(),
          tax: z
            .object({
              gstin: z.string().regex(GSTIN_PATTERN, "Enter a valid 15-character GSTIN").nullable(),
              sellerState: z.string().max(100).nullable(),
              pricesIncludeTax: z.boolean(),
            })
            .optional(),
        }),
      )
      .output(StoreSettings),
  },
  featureFlags: {
    list: oc
      .route({ method: "GET", path: "/admin/feature-flags" })
      .output(z.array(FeatureFlagItem)),
  },

  // Catalog: Products
  products: {
    list: oc
      .route({ method: "GET", path: "/admin/products" })
      .input(
        z
          .object({
            search: z.string().optional(),
            status: z.enum(["draft", "active", "archived"]).optional(),
            categoryId: z.string().uuid().optional(),
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .optional(),
      )
      .output(z.object({ items: z.array(Product), total: z.number() })),
    get: oc
      .route({ method: "GET", path: "/admin/products/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(ProductDetail),
    create: oc
      .route({ method: "POST", path: "/admin/products" })
      .input(
        z.object({
          title: z.string().min(1),
          slug: z.string().optional(),
          status: z.enum(["draft", "active", "archived"]).default("draft"),
          descriptionJson: z.unknown().optional(),
          shortDescription: z.string().optional(),
          brandId: z.string().uuid().optional(),
          productType: z.string().optional(),
          tags: z.array(z.string()).default([]),
          requiresShipping: z.boolean().default(true),
          isFeatured: z.boolean().default(false),
          options: z
            .array(
              z.object({
                name: z.string().min(1),
                values: z.array(z.string()).min(1),
              }),
            )
            .optional(),
          variants: z
            .array(
              z.object({
                sku: z.string().min(1),
                title: z.string().min(1),
                price: z.number().int().min(0),
                compareAtPrice: z.number().int().min(0).optional(),
                costPrice: z.number().int().min(0).optional(),
                trackInventory: z.boolean().default(true),
                allowBackorder: z.boolean().default(false),
                optionValues: z.record(z.string(), z.string()).optional(),
                imageMediaId: z.string().uuid().optional(),
              }),
            )
            .optional(),
        }),
      )
      .output(ProductDetail),
    update: oc
      .route({ method: "PATCH", path: "/admin/products/{id}" })
      .input(
        z.object({
          id: z.string().uuid(),
          title: z.string().min(1).optional(),
          slug: z.string().optional(),
          status: z.enum(["draft", "active", "archived"]).optional(),
          descriptionJson: z.unknown().optional(),
          shortDescription: z.string().optional(),
          brandId: z.string().uuid().nullable().optional(),
          productType: z.string().optional(),
          tags: z.array(z.string()).optional(),
          requiresShipping: z.boolean().optional(),
          isFeatured: z.boolean().optional(),
        }),
      )
      .output(Product),
    delete: oc
      .route({ method: "DELETE", path: "/admin/products/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
  },

  // Catalog: Variants
  variants: {
    update: oc
      .route({ method: "PATCH", path: "/admin/variants/{id}" })
      .input(
        z.object({
          id: z.string().uuid(),
          sku: z.string().min(1).optional(),
          title: z.string().min(1).optional(),
          price: z.number().int().min(0).optional(),
          compareAtPrice: z.number().int().min(0).nullable().optional(),
          costPrice: z.number().int().min(0).nullable().optional(),
          trackInventory: z.boolean().optional(),
          allowBackorder: z.boolean().optional(),
          imageMediaId: z.string().uuid().nullable().optional(),
        }),
      )
      .output(ProductVariant),
  },

  // Catalog: Categories
  categories: {
    list: oc
      .route({ method: "GET", path: "/admin/categories" })
      .input(z.object({ parentId: z.string().uuid().nullable().optional() }).optional())
      .output(z.array(Category)),
    create: oc
      .route({ method: "POST", path: "/admin/categories" })
      .input(
        z.object({
          name: z.string().min(1),
          slug: z.string().optional(),
          description: z.string().optional(),
          parentId: z.string().uuid().optional(),
          position: z.number().int().default(0),
        }),
      )
      .output(Category),
    update: oc
      .route({ method: "PATCH", path: "/admin/categories/{id}" })
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(1).optional(),
          slug: z.string().optional(),
          description: z.string().optional(),
          parentId: z.string().uuid().nullable().optional(),
          position: z.number().int().optional(),
        }),
      )
      .output(Category),
    delete: oc
      .route({ method: "DELETE", path: "/admin/categories/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
  },

  // Catalog: Collections
  collections: {
    list: oc
      .route({ method: "GET", path: "/admin/collections" })
      .output(z.array(Collection)),
    get: oc
      .route({ method: "GET", path: "/admin/collections/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(CollectionDetail),
    create: oc
      .route({ method: "POST", path: "/admin/collections" })
      .input(
        z.object({
          title: z.string().min(1),
          slug: z.string().optional(),
          description: z.string().optional(),
          isAutomated: z.boolean().default(false),
          rules: z.unknown().optional(),
          productIds: z.array(z.string().uuid()).optional(),
        }),
      )
      .output(Collection),
    update: oc
      .route({ method: "PATCH", path: "/admin/collections/{id}" })
      .input(
        z.object({
          id: z.string().uuid(),
          title: z.string().min(1).optional(),
          slug: z.string().optional(),
          description: z.string().optional(),
          isAutomated: z.boolean().optional(),
          rules: z.unknown().optional(),
          productIds: z.array(z.string().uuid()).optional(),
        }),
      )
      .output(Collection),
    delete: oc
      .route({ method: "DELETE", path: "/admin/collections/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
  },

  // Catalog: Brands
  brands: {
    list: oc
      .route({ method: "GET", path: "/admin/brands" })
      .output(z.array(Brand)),
    create: oc
      .route({ method: "POST", path: "/admin/brands" })
      .input(
        z.object({
          name: z.string().min(1),
          slug: z.string().optional(),
          logoMediaId: z.string().uuid().optional(),
        }),
      )
      .output(Brand),
    update: oc
      .route({ method: "PATCH", path: "/admin/brands/{id}" })
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(1).optional(),
          slug: z.string().optional(),
          logoMediaId: z.string().uuid().nullable().optional(),
        }),
      )
      .output(Brand),
    delete: oc
      .route({ method: "DELETE", path: "/admin/brands/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
  },

  // Inventory
  inventory: {
    list: oc
      .route({ method: "GET", path: "/admin/inventory" })
      .input(
        z
          .object({
            locationId: z.string().uuid().optional(),
            search: z.string().optional(),
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .optional(),
      )
      .output(z.object({ items: z.array(InventoryLevelItem), total: z.number() })),
    adjust: oc
      .route({ method: "POST", path: "/admin/inventory/adjust" })
      .input(
        z.object({
          variantId: z.string().uuid(),
          locationId: z.string().uuid(),
          quantityDelta: z.number().int(),
          reason: z.enum(["received", "sold", "damaged", "returned", "correction", "transfer"]),
          notes: z.string().optional(),
        }),
      )
      .output(z.object({ success: z.boolean(), newOnHand: z.number() })),
  },

  // Media
  media: {
    list: oc
      .route({ method: "GET", path: "/admin/media" })
      .input(
        z
          .object({
            folder: z.string().optional(),
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .optional(),
      )
      .output(z.object({ items: z.array(MediaItem), total: z.number() })),
    requestUpload: oc
      .route({ method: "POST", path: "/admin/media/request-upload" })
      .input(
        z.object({
          filename: z.string().min(1),
          mime: z.string().min(1),
          bytes: z.number().int().min(1),
          folder: z.string().default("products"),
        }),
      )
      .output(PresignedUploadResponse),
    create: oc
      .route({ method: "POST", path: "/admin/media" })
      .input(
        z.object({
          storageKey: z.string().min(1),
          mime: z.string().min(1),
          bytes: z.number().int().min(1),
          width: z.number().int().optional(),
          height: z.number().int().optional(),
          alt: z.string().optional(),
          folder: z.string().default("products"),
          cfImageId: z.string().optional(),
        }),
      )
      .output(MediaItem),
    delete: oc
      .route({ method: "DELETE", path: "/admin/media/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
  },

  // Branding
  branding: {
    get: oc
      .route({ method: "GET", path: "/admin/branding" })
      .output(BrandSettings),
    update: oc
      .route({ method: "PATCH", path: "/admin/branding" })
      .input(
        z.object({
          logoLightMediaId: z.string().uuid().nullable().optional(),
          logoDarkMediaId: z.string().uuid().nullable().optional(),
          logoWidth: z.number().int().min(20).max(1000).optional(),
          faviconMediaId: z.string().uuid().nullable().optional(),
          socialImageMediaId: z.string().uuid().nullable().optional(),
          fontHeading: z.string().optional(),
          fontBody: z.string().optional(),
          fontSizeScale: z.string().optional(),
          colorSchemeName: z.string().optional(),
          primaryColor: z.string().optional(),
          secondaryColor: z.string().optional(),
          accentColor: z.string().optional(),
          backgroundColor: z.string().optional(),
          surfaceColor: z.string().optional(),
          textColor: z.string().optional(),
          colorMode: z.enum(["light", "dark", "auto"]).optional(),
          cornerRadius: z.enum(["none", "small", "medium", "large", "full"]).optional(),
          buttonStyle: z.enum(["solid", "outline", "pill"]).optional(),
        }),
      )
      .output(BrandSettings),
    publish: oc
      .route({ method: "POST", path: "/admin/branding/publish" })
      .output(z.object({ version: z.number() })),
  },

  // Themes
  themes: {
    get: oc
      .route({ method: "GET", path: "/admin/theme" })
      .output(Theme),
    update: oc
      .route({ method: "PATCH", path: "/admin/theme" })
      .input(
        z.object({
          tokens: z.record(z.string(), z.unknown()).optional(),
          settings: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .output(Theme),
  },

  // Pages
  pages: {
    list: oc
      .route({ method: "GET", path: "/admin/pages" })
      .output(z.array(PageItem)),
    get: oc
      .route({ method: "GET", path: "/admin/pages/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(PageDetail),
    create: oc
      .route({ method: "POST", path: "/admin/pages" })
      .input(
        z.object({
          title: z.string().min(1),
          slug: z.string().min(1),
          description: z.string().optional(),
        }),
      )
      .output(PageItem),
    update: oc
      .route({ method: "PATCH", path: "/admin/pages/{id}" })
      .input(
        z.object({
          id: z.string().uuid(),
          title: z.string().min(1).optional(),
          slug: z.string().optional(),
          description: z.string().optional(),
          seo: z.unknown().optional(),
        }),
      )
      .output(PageItem),
    saveDraft: oc
      .route({ method: "POST", path: "/admin/pages/{id}/draft" })
      .input(
        z.object({
          id: z.string().uuid(),
          blocks: z.array(z.unknown()),
        }),
      )
      .output(z.object({ versionId: z.string().uuid() })),
    publish: oc
      .route({ method: "POST", path: "/admin/pages/{id}/publish" })
      .input(
        z.object({
          id: z.string().uuid(),
          versionId: z.string().uuid().optional(),
        }),
      )
      .output(z.object({ success: z.boolean(), publishedVersionId: z.string().uuid() })),
    rollback: oc
      .route({ method: "POST", path: "/admin/pages/{id}/rollback" })
      .input(
        z.object({
          id: z.string().uuid(),
          targetVersionId: z.string().uuid(),
        }),
      )
      .output(z.object({ success: z.boolean(), publishedVersionId: z.string().uuid() })),
  },

  // Menus
  menus: {
    list: oc
      .route({ method: "GET", path: "/admin/menus" })
      .output(z.array(Menu)),
    get: oc
      .route({ method: "GET", path: "/admin/menus/{handle}" })
      .input(z.object({ handle: z.string() }))
      .output(MenuDetail),
    create: oc
      .route({ method: "POST", path: "/admin/menus" })
      .input(
        z.object({
          name: z.string().min(1),
          handle: z.string().min(1),
          items: z.array(z.unknown()).default([]),
        }),
      )
      .output(Menu),
    update: oc
      .route({ method: "PATCH", path: "/admin/menus/{id}" })
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(1).optional(),
          items: z.array(z.unknown()).optional(),
        }),
      )
      .output(Menu),
    delete: oc
      .route({ method: "DELETE", path: "/admin/menus/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
  },

  // --- M5 Orders Admin ---
  orders: {
    list: oc
      .route({ method: "GET", path: "/admin/orders" })
      .input(
        z
          .object({
            view: z.enum(["all", "unfulfilled", "unpaid", "cod_to_confirm", "rto"]).default("all"),
            search: z.string().optional(),
            status: z.string().optional(),
            paymentStatus: z.string().optional(),
            fulfillmentStatus: z.string().optional(),
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .optional(),
      )
      .output(
        z.object({
          items: z.array(
            z.object({
              id: z.string().uuid(),
              number: z.string(),
              customerEmail: z.string(),
              customerPhone: z.string(),
              status: z.string(),
              paymentStatus: z.string(),
              fulfillmentStatus: z.string(),
              grandTotal: z.number(),
              placedAt: z.string(),
              itemsCount: z.number(),
            }),
          ),
          total: z.number(),
        }),
      ),
    get: oc
      .route({ method: "GET", path: "/admin/orders/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(
        z.object({
          order: z.object({
            id: z.string().uuid(),
            number: z.string(),
            email: z.string(),
            phone: z.string(),
            status: z.string(),
            paymentStatus: z.string(),
            fulfillmentStatus: z.string(),
            subtotal: z.number(),
            discountTotal: z.number(),
            shippingTotal: z.number(),
            taxTotal: z.number(),
            grandTotal: z.number(),
            codFee: z.number(),
            shippingAddress: z.unknown(),
            billingAddress: z.unknown().nullable().optional(),
            placedAt: z.string(),
            cancelledAt: z.string().nullable().optional(),
            cancelReason: z.string().nullable().optional(),
          }),
          items: z.array(
            z.object({
              id: z.string().uuid(),
              productTitle: z.string(),
              variantTitle: z.string().nullable().optional(),
              sku: z.string().nullable().optional(),
              quantity: z.number(),
              unitPrice: z.number(),
              total: z.number(),
              fulfilledQty: z.number(),
              returnedQty: z.number(),
            }),
          ),
          fulfillments: z.array(
            z.object({
              id: z.string().uuid(),
              status: z.string(),
              carrier: z.string().nullable().optional(),
              awb: z.string().nullable().optional(),
              trackingUrl: z.string().nullable().optional(),
              shippedAt: z.string().nullable().optional(),
              deliveredAt: z.string().nullable().optional(),
            }),
          ),
          invoices: z.array(
            z.object({
              id: z.string().uuid(),
              number: z.string(),
              fy: z.string(),
              type: z.string(),
              issuedAt: z.string(),
              totals: z.unknown(),
            }),
          ),
          events: z.array(
            z.object({
              id: z.string().uuid(),
              type: z.string(),
              message: z.string(),
              actorType: z.string(),
              createdAt: z.string(),
            }),
          ),
          notes: z.array(
            z.object({
              id: z.string().uuid(),
              body: z.string(),
              createdAt: z.string(),
            }),
          ),
        }),
      ),
    createDraft: oc
      .route({ method: "POST", path: "/admin/orders/draft" })
      .input(
        z.object({
          email: z.string().email(),
          phone: z.string().min(5),
          shippingAddress: z.record(z.string(), z.unknown()),
          items: z.array(
            z.object({
              variantId: z.string().uuid(),
              quantity: z.number().int().min(1),
            }),
          ),
        }),
      )
      .output(
        z.object({
          orderId: z.string().uuid(),
          orderNumber: z.string(),
          grandTotal: z.number(),
          payLink: z.string().optional(),
        }),
      ),
    addNote: oc
      .route({ method: "POST", path: "/admin/orders/{id}/notes" })
      .input(
        z.object({
          id: z.string().uuid(),
          body: z.string().min(1),
        }),
      )
      .output(z.object({ success: z.boolean(), noteId: z.string().uuid() })),
    cancel: oc
      .route({ method: "POST", path: "/admin/orders/{id}/cancel" })
      .input(
        z.object({
          id: z.string().uuid(),
          reason: z.string().min(1),
        }),
      )
      .output(z.object({ success: z.boolean() })),
    refund: oc
      .route({ method: "POST", path: "/admin/orders/{id}/refund" })
      .input(
        z.object({
          id: z.string().uuid(),
          amount: z.number().int().min(1),
          reason: z.string().optional(),
        }),
      )
      .output(z.object({ success: z.boolean(), refundId: z.string().uuid() })),
    createFulfillment: oc
      .route({ method: "POST", path: "/admin/orders/{id}/fulfill" })
      .input(
        z.object({
          id: z.string().uuid(),
          locationId: z.string().uuid().optional(),
          carrier: z.string().optional(),
          awb: z.string().optional(),
          items: z
            .array(
              z.object({
                orderItemId: z.string().uuid(),
                quantity: z.number().int().min(1),
              }),
            )
            .optional(),
        }),
      )
      .output(z.object({ fulfillmentId: z.string().uuid(), status: z.string() })),
    createInvoice: oc
      .route({ method: "POST", path: "/admin/orders/{id}/invoice" })
      .input(
        z.object({
          id: z.string().uuid(),
        }),
      )
      .output(z.object({ invoiceId: z.string().uuid(), invoiceNumber: z.string() })),
  },

  // --- M5 Customers Admin ---
  customers: {
    list: oc
      .route({ method: "GET", path: "/admin/customers" })
      .input(
        z
          .object({
            search: z.string().optional(),
            tag: z.string().optional(),
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .optional(),
      )
      .output(
        z.object({
          items: z.array(
            z.object({
              id: z.string().uuid(),
              name: z.string(),
              email: z.string(),
              phone: z.string(),
              ordersCount: z.number(),
              totalSpent: z.number(),
              tags: z.array(z.string()),
              status: z.string(),
              createdAt: z.string(),
            }),
          ),
          total: z.number(),
        }),
      ),
    get: oc
      .route({ method: "GET", path: "/admin/customers/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(
        z.object({
          customer: z.object({
            id: z.string().uuid(),
            name: z.string(),
            email: z.string(),
            phone: z.string(),
            ordersCount: z.number(),
            totalSpent: z.number(),
            tags: z.array(z.string()),
            note: z.string().nullable().optional(),
            acceptsMarketing: z.boolean(),
            createdAt: z.string(),
          }),
          addresses: z.array(
            z.object({
              id: z.string().uuid(),
              name: z.string(),
              phone: z.string(),
              line1: z.string(),
              line2: z.string().nullable().optional(),
              city: z.string(),
              stateCode: z.string(),
              pincode: z.string(),
              type: z.string(),
              isDefault: z.boolean(),
            }),
          ),
          recentOrders: z.array(
            z.object({
              id: z.string().uuid(),
              number: z.string(),
              status: z.string(),
              grandTotal: z.number(),
              placedAt: z.string(),
            }),
          ),
        }),
      ),
  },

  // --- M5 Discounts Admin ---
  discounts: {
    list: oc
      .route({ method: "GET", path: "/admin/discounts" })
      .input(
        z
          .object({
            search: z.string().optional(),
            status: z.string().optional(),
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .optional(),
      )
      .output(
        z.object({
          items: z.array(
            z.object({
              id: z.string().uuid(),
              code: z.string().nullable(),
              title: z.string(),
              type: z.string(),
              value: z.number(),
              usageLimit: z.number().nullable(),
              usedCount: z.number(),
              status: z.string(),
              combinable: z.boolean(),
              startsAt: z.string().nullable().optional(),
              endsAt: z.string().nullable().optional(),
              createdAt: z.string(),
            }),
          ),
          total: z.number(),
        }),
      ),
    create: oc
      .route({ method: "POST", path: "/admin/discounts" })
      .input(
        z.object({
          code: z.string().min(1).optional(),
          title: z.string().min(1),
          type: z.enum(["percent", "fixed", "free_shipping", "buy_x_get_y"]),
          value: z.number().int().min(0),
          minSubtotal: z.number().int().min(0).optional(),
          usageLimit: z.number().int().min(1).optional(),
          perCustomerLimit: z.number().int().min(1).optional(),
          combinable: z.boolean().default(false),
          startsAt: z.string().optional(),
          endsAt: z.string().optional(),
        }),
      )
      .output(
        z.object({
          id: z.string().uuid(),
          code: z.string().nullable(),
          title: z.string(),
          type: z.string(),
          value: z.number(),
          status: z.string(),
        }),
      ),
    update: oc
      .route({ method: "PATCH", path: "/admin/discounts/{id}" })
      .input(
        z.object({
          id: z.string().uuid(),
          title: z.string().min(1).optional(),
          status: z.enum(["active", "scheduled", "expired", "disabled"]).optional(),
          usageLimit: z.number().int().min(1).nullable().optional(),
        }),
      )
      .output(
        z.object({
          id: z.string().uuid(),
          status: z.string(),
        }),
      ),
    delete: oc
      .route({ method: "DELETE", path: "/admin/discounts/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
  },
};
