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

export const OrderSettings = z.object({
  prefix: z.string().max(10).regex(/^[A-Za-z0-9#\-_/]*$/, "Prefix can only contain letters, numbers, and # - _ /"),
  padding: z.number().int().min(3).max(8),
  nextValue: z.number().int().min(1),
  currentNextValue: z.number().int().min(1),
});
export type OrderSettings = z.infer<typeof OrderSettings>;

export const UpdateOrderSettingsInput = z.object({
  prefix: z.string().max(10).regex(/^[A-Za-z0-9#\-_/]*$/, "Prefix can only contain letters, numbers, and # - _ /").optional(),
  padding: z.number().int().min(3).max(8).optional(),
  nextValue: z.number().int().min(1).optional(),
});
export type UpdateOrderSettingsInput = z.infer<typeof UpdateOrderSettingsInput>;

export const OrderStats = z.object({
  totalOrders: z.number().int(),
  openOrders: z.number().int(),
  paidOrders: z.number().int(),
  totalRevenue: z.number().int(),
  avgOrderValue: z.number().int(),
});
export type OrderStats = z.infer<typeof OrderStats>;

export const PreorderListItem = z.object({
  id: z.string().uuid(),
  number: z.string(),
  customerEmail: z.string().nullable(),
  customerPhone: z.string().nullable(),
  customerName: z.string().nullable(),
  status: z.string(),
  paymentStatus: z.string(),
  fulfillmentStatus: z.string(),
  grandTotal: z.number(),
  placedAt: z.string(),
  shipsOn: z.string(),
  preorderReleasedAt: z.string().nullable(),
  itemsCount: z.number(),
  preorderItemsCount: z.number(),
  firstItemTitle: z.string().nullable(),
});
export type PreorderListItem = z.infer<typeof PreorderListItem>;

export const PreorderStats = z.object({
  openPreorders: z.number().int(),
  readyToShip: z.number().int(),
  dueNext14Days: z.number().int(),
  overdue: z.number().int(),
});
export type PreorderStats = z.infer<typeof PreorderStats>;

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
  preorderEnabled: z.boolean().default(false),
  preorderShipsOn: z.string().nullable().optional(),
  preorderMessage: z.string().nullable().optional(),
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
  status: z.enum(["draft", "active", "unlisted", "archived"]),
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
  priceOnRequest: z.boolean().default(false),
  ratingAvg: z.string(),
  ratingCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** List summaries (paise / units). Present on list results. */
  variantCount: z.number().optional(),
  priceMin: z.number().nullable().optional(),
  priceMax: z.number().nullable().optional(),
  stock: z.number().optional(),
  preorderStatus: z.enum(["active", "passed"]).nullable().optional(),
});
export type Product = z.infer<typeof Product>;

export const ProductDetail = Product.extend({
  options: z.array(ProductOption),
  variants: z.array(ProductVariant),
  media: z.array(ProductMedia),
});
export type ProductDetail = z.infer<typeof ProductDetail>;

export const CategorySeo = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export type CategorySeo = z.infer<typeof CategorySeo>;

export const Category = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  imageMediaId: z.string().uuid().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  position: z.number(),
  path: z.string().optional(),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  seo: CategorySeo.nullable().optional(),
  productCount: z.number().int().optional(),
  childrenCount: z.number().int().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Category = z.infer<typeof Category>;

export const CategoryStats = z.object({
  total: z.number().int(),
  active: z.number().int(),
  inactive: z.number().int(),
  parents: z.number().int(),
  productsAssigned: z.number().int(),
});
export type CategoryStats = z.infer<typeof CategoryStats>;

export const CollectionRule = z.object({
  field: z.enum(["tag", "product_type", "brand", "category", "price", "in_stock", "title"]),
  operator: z.enum([
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "greater_than",
    "less_than",
    "is_set",
    "is_not_set",
  ]),
  value: z.unknown(),
});
export type CollectionRule = z.infer<typeof CollectionRule>;

export const CollectionSeo = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export type CollectionSeo = z.infer<typeof CollectionSeo>;

export const Collection = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  imageMediaId: z.string().uuid().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  type: z.enum(["manual", "automated"]),
  match: z.enum(["all", "any"]),
  rules: z.array(CollectionRule).nullable().optional(),
  sortOrder: z.string(),
  published: z.boolean(),
  indexable: z.boolean(),
  productCount: z.number().int().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Collection = z.infer<typeof Collection>;

export const CollectionStats = z.object({
  total: z.number().int(),
  active: z.number().int(),
  draft: z.number().int(),
  manual: z.number().int(),
  automated: z.number().int(),
  indexable: z.number().int(),
});
export type CollectionStats = z.infer<typeof CollectionStats>;

export const CollectionDetail = Collection.extend({
  seo: CollectionSeo.nullable().optional(),
  productIds: z.array(z.string().uuid()),
  products: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string(),
        slug: z.string(),
        status: z.string(),
        imageUrl: z.string().nullable().optional(),
        priceMin: z.number().nullable().optional(),
      }),
    )
    .optional(),
});
export type CollectionDetail = z.infer<typeof CollectionDetail>;

export const BrandStats = z.object({
  total: z.number().int(),
  used: z.number().int(),
  unused: z.number().int(),
});
export type BrandStats = z.infer<typeof BrandStats>;

export const Brand = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  logoMediaId: z.string().uuid().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  productCount: z.number().int().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});
export type Brand = z.infer<typeof Brand>;

export const LocationAddress = z.object({
  line1: z.string().optional(),
  line2: z.string().nullable().optional(),
  city: z.string().optional(),
  stateCode: z.string().optional(),
  countryCode: z.string().default("IN"),
});
export type LocationAddress = z.infer<typeof LocationAddress>;

export const Location = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: LocationAddress.nullable().optional(),
  pincode: z.string().nullable().optional(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  stockCount: z.number().int().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Location = z.infer<typeof Location>;

export const LocationStats = z.object({
  total: z.number().int(),
  active: z.number().int(),
  inactive: z.number().int(),
});
export type LocationStats = z.infer<typeof LocationStats>;

// --- M2 Inventory Schemas ---
export const InventoryLevelItem = z.object({
  /** The stock row id, or "variantId:locationId" for a variant that has never had stock. */
  id: z.string(),
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
export const StorefrontStatus = z.object({
  mode: z.enum(["live", "coming_soon", "maintenance", "password"]),
  headline: z.string().nullable(),
  showCountdown: z.boolean(),
  collectEmails: z.boolean(),
  launchAt: z.string().nullable(),
  hasPassword: z.boolean(),
});

export type StorefrontStatus = z.infer<typeof StorefrontStatus>;

export const BrandSettings = z.object({
  // "default" until the store saves branding for the first time (no row yet), so not a uuid.
  id: z.string(),
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
  // "default-theme" until a theme is activated (no row yet), so not a uuid.
  id: z.string(),
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
  /** home, landing, custom, or a theme system page (header, footer, product_template, collection_template). */
  type: z.string().optional(),
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
  draftVersionId: z.string().uuid().nullable().optional(),
  hasUnpublishedChanges: z.boolean().optional(),
});
export type PageDetail = z.infer<typeof PageDetail>;

export const ThemeLibraryItem = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  industry: z.string(),
  features: z.array(z.string()),
  previewImageKey: z.string().nullable(),
  version: z.number(),
  isCurrent: z.boolean(),
  installedVersion: z.number().nullable(),
  updateAvailable: z.boolean(),
});
export type ThemeLibraryItem = z.infer<typeof ThemeLibraryItem>;

export const PageVersionItem = z.object({
  id: z.string().uuid(),
  note: z.string().nullable(),
  createdAt: z.string(),
  isPublished: z.boolean(),
  isDraft: z.boolean(),
});
export type PageVersionItem = z.infer<typeof PageVersionItem>;

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

// --- M7 Configurable Shipping Schemas (PLAN §5.4) ---
export const ShippingRateItem = z.object({
  id: z.string().uuid(),
  name: z.string(),
  method: z.string(),
  rateType: z.string(),
  pricePaise: z.number().int(),
  thresholdPaise: z.number().int().nullable().optional(),
  minDays: z.number().int().nullable().optional(),
  maxDays: z.number().int().nullable().optional(),
});
export type ShippingRateItem = z.infer<typeof ShippingRateItem>;

export const ShippingZoneItem = z.object({
  id: z.string().uuid(),
  name: z.string(),
  countries: z.array(z.string()),
  isDefault: z.boolean(),
  rates: z.array(ShippingRateItem),
});
export type ShippingZoneItem = z.infer<typeof ShippingZoneItem>;

export const ShippingSettings = z.object({
  zones: z.array(ShippingZoneItem),
});
export type ShippingSettings = z.infer<typeof ShippingSettings>;

export const UpdateShippingInput = z.object({
  zoneName: z.string().min(1).default("Domestic (India)"),
  standardRatePaise: z.number().int().min(0).default(0),
  expressRatePaise: z.number().int().min(0).default(15000),
  freeShippingThresholdPaise: z.number().int().min(0).nullable().optional(),
});
export type UpdateShippingInput = z.infer<typeof UpdateShippingInput>;

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
export const AdminMeSupport = z.object({
  sessionId: z.string().uuid(),
  scope: z.enum(["read_only", "write"]),
  consent: z.enum(["owner_approved", "standing_consent", "emergency"]),
  reason: z.string(),
  ticketRef: z.string(),
  expiresAt: z.string(),
});
export const AdminMe = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string(), name: z.string() }),
  stores: z.array(AdminMeStore),
  /** Present only when the caller is a platform support session (X-Support-Token), never for a normal sign-in. */
  support: AdminMeSupport.optional(),
});
export type AdminMe = z.infer<typeof AdminMe>;

export const StoreSupportSession = z.object({
  id: z.string().uuid(),
  staffName: z.string(),
  staffEmail: z.string(),
  reason: z.string(),
  ticketRef: z.string(),
  consent: z.enum(["owner_approved", "standing_consent", "emergency"]),
  scope: z.enum(["read_only", "write"]),
  status: z.enum(["pending_owner_approval", "active", "denied", "ended", "expired"]),
  requestedAt: z.string(),
  expiresAt: z.string(),
  actionsCount: z.number(),
});

// --- Quotes Schemas ---
export const QuoteRequest = z.object({
  id: z.string().uuid(),
  number: z.string(),
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  productTitle: z.string(),
  variantTitle: z.string(),
  quantity: z.number().int().min(1),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  company: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  status: z.enum(["new", "quoted", "accepted", "lost", "expired"]),
  derivedStage: z.enum(["needs_reply", "quote_sent", "accepted", "expired", "closed"]),
  adminNote: z.string().nullable().optional(),
  quotedTotal: z.number().nullable().optional(),
  quoteNote: z.string().nullable().optional(),
  validUntil: z.string().nullable().optional(),
  quotedAt: z.string().nullable().optional(),
  orderId: z.string().uuid().nullable().optional(),
  orderNumber: z.string().nullable().optional(),
  orderStatus: z.string().nullable().optional(),
  orderPaymentStatus: z.string().nullable().optional(),
  orderConfirmUrl: z.string().nullable().optional(),
  orderViewUrl: z.string().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QuoteRequest = z.infer<typeof QuoteRequest>;

export const QuoteStats = z.object({
  needsReply: z.number().int().min(0),
  quoteSent: z.number().int().min(0),
  expired: z.number().int().min(0),
  accepted: z.number().int().min(0),
  totalQuotesValue: z.number().int().min(0),
});
export type QuoteStats = z.infer<typeof QuoteStats>;

export const AbandonedCheckoutItem = z.object({
  id: z.string().uuid(),
  cartToken: z.string(),
  customer: z.object({
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
  }),
  itemsSummary: z.object({
    firstTitle: z.string().nullable().optional(),
    count: z.number().int(),
    productId: z.string().uuid().nullable().optional(),
    productSlug: z.string().nullable().optional(),
  }),
  total: z.number().int(), // minor units / paise
  currency: z.string().default("INR"),
  abandonedAt: z.string(),
  recovered: z.boolean(),
  recoveredAt: z.string().nullable().optional(),
  emailStatus: z.enum(["not_sent", "sent", "failed", "not_applicable"]),
  recoverySentAt: z.string().nullable().optional(),
});
export type AbandonedCheckoutItem = z.infer<typeof AbandonedCheckoutItem>;

export const AbandonedCheckoutStats = z.object({
  abandoned: z.number().int().min(0),
  open: z.number().int().min(0),
  recovered: z.number().int().min(0),
  emailsSent: z.number().int().min(0),
  potentialRevenue: z.number().int().min(0), // paise
});
export type AbandonedCheckoutStats = z.infer<typeof AbandonedCheckoutStats>;

export const ReturnReasonConfig = z.object({
  id: z.string(),
  label: z.string(),
  photoRequirement: z.enum(["required", "optional", "not_asked"]),
});
export type ReturnReasonConfig = z.infer<typeof ReturnReasonConfig>;

export const ReturnSettings = z.object({
  acceptReturns: z.boolean(),
  allowExchanges: z.boolean(),
  returnWindowDays: z.number().int().min(1).max(90),
  reasons: z.array(ReturnReasonConfig),
  instructions: z.string(),
  policyText: z.string(),
});
export type ReturnSettings = z.infer<typeof ReturnSettings>;

export const AdminReturnStats = z.object({
  needsReview: z.number().int().min(0),
  awaitingItem: z.number().int().min(0),
  toResolve: z.number().int().min(0),
  resolvedLast30Days: z.number().int().min(0),
});
export type AdminReturnStats = z.infer<typeof AdminReturnStats>;

export const AdminReturnItem = z.object({
  title: z.string(),
  variantTitle: z.string().nullable().optional(),
  quantity: z.number().int(),
  unitPrice: z.number().int(),
  lineTotal: z.number().int(),
});
export type AdminReturnItem = z.infer<typeof AdminReturnItem>;

export const AdminReturnListItem = z.object({
  id: z.string().uuid(),
  number: z.string(),
  status: z.string(),
  reason: z.string(),
  resolution: z.string(),
  requestedResolution: z.string().nullable().optional(),
  customerComment: z.string().nullable().optional(),
  exchangeRequest: z.string().nullable().optional(),
  decisionMessage: z.string().nullable().optional(),
  adminNote: z.string().nullable().optional(),
  refundMethod: z.string().nullable().optional(),
  refundReference: z.string().nullable().optional(),
  refundAmount: z.number().nullable().optional(),
  refundedAt: z.string().nullable().optional(),
  exchangeNote: z.string().nullable().optional(),
  exchangeOrderId: z.string().uuid().nullable().optional(),
  photosCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  orderId: z.string().uuid(),
  orderNumber: z.string(),
  orderStatus: z.string(),
  customerEmail: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  items: z.array(AdminReturnItem),
  computedRefundAmount: z.number().int(),
});
export type AdminReturnListItem = z.infer<typeof AdminReturnListItem>;

export const AdminReturnDetail = z.object({
  id: z.string().uuid(),
  number: z.string(),
  status: z.string(),
  reason: z.string(),
  resolution: z.string(),
  requestedResolution: z.string().nullable().optional(),
  customerComment: z.string().nullable().optional(),
  exchangeRequest: z.string().nullable().optional(),
  decisionMessage: z.string().nullable().optional(),
  adminNote: z.string().nullable().optional(),
  refundMethod: z.string().nullable().optional(),
  refundReference: z.string().nullable().optional(),
  refundAmount: z.number().nullable().optional(),
  refundedAt: z.string().nullable().optional(),
  exchangeNote: z.string().nullable().optional(),
  exchangeOrderId: z.string().uuid().nullable().optional(),
  photos: z.array(z.object({ id: z.string(), url: z.string(), filename: z.string() })),
  createdAt: z.string(),
  updatedAt: z.string(),
  order: z.object({
    id: z.string().uuid(),
    number: z.string(),
    status: z.string(),
    paymentStatus: z.string(),
    grandTotal: z.number(),
    totalAlreadyRefunded: z.number(),
    maxRefundable: z.number(),
    paymentMethod: z.string(),
    customerEmail: z.string().nullable().optional(),
    customerName: z.string().nullable().optional(),
    customerPhone: z.string().nullable().optional(),
    shippingAddress: z.record(z.string(), z.unknown()).nullable().optional(),
    createdAt: z.string(),
  }),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      orderItemId: z.string().uuid(),
      title: z.string(),
      variantTitle: z.string().nullable().optional(),
      quantity: z.number().int(),
      bought: z.number().int(),
      unitPrice: z.number().int(),
      lineTotal: z.number().int(),
      restock: z.boolean(),
    }),
  ),
  computedRefundAmount: z.number().int(),
  timeline: z.array(
    z.object({
      id: z.string().uuid(),
      type: z.string(),
      message: z.string(),
      actorType: z.string(),
      actorId: z.string().nullable().optional(),
      createdAt: z.string(),
      data: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
  ),
});
export type AdminReturnDetail = z.infer<typeof AdminReturnDetail>;

export const adminContract = {
  support: {
    list: oc.route({ method: "GET", path: "/admin/support/sessions" }).output(z.array(StoreSupportSession)),
    approve: oc
      .route({ method: "POST", path: "/admin/support/sessions/{id}/approve" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ ok: z.literal(true) })),
    deny: oc
      .route({ method: "POST", path: "/admin/support/sessions/{id}/deny" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ ok: z.literal(true) })),
    getStandingConsent: oc.route({ method: "GET", path: "/admin/support/standing-consent" }).output(z.object({ enabled: z.boolean() })),
    setStandingConsent: oc
      .route({ method: "PUT", path: "/admin/support/standing-consent" })
      .input(z.object({ enabled: z.boolean() }))
      .output(z.object({ enabled: z.boolean() })),
  },
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
  orderSettings: {
    get: oc
      .route({ method: "GET", path: "/admin/settings/orders" })
      .output(OrderSettings),
    update: oc
      .route({ method: "PUT", path: "/admin/settings/orders" })
      .input(UpdateOrderSettingsInput)
      .output(OrderSettings),
  },
  featureFlags: {
    list: oc
      .route({ method: "GET", path: "/admin/feature-flags" })
      .output(z.array(FeatureFlagItem)),
  },

  // Catalog: Products
  products: {
    attachMedia: oc
      .route({ method: "POST", path: "/admin/products/{id}/media" })
      .input(z.object({ id: z.string().uuid(), mediaId: z.string().uuid(), alt: z.string().max(200).optional() }))
      .output(z.object({ id: z.string().uuid(), position: z.number(), isPrimary: z.boolean(), url: z.string().optional() })),
    detachMedia: oc
      .route({ method: "DELETE", path: "/admin/products/{id}/media/{productMediaId}" })
      .input(z.object({ id: z.string().uuid(), productMediaId: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
    list: oc
      .route({ method: "GET", path: "/admin/products" })
      .input(
        z
          .object({
            search: z.string().optional(),
            status: z.enum(["draft", "active", "unlisted", "archived"]).optional(),
            categoryId: z.string().uuid().optional(),
            /** Sellable stock: in_stock (>5), low (1-5) or out (0 or less). */
            stock: z.enum(["in_stock", "low", "out"]).optional(),
            createdFrom: z.string().optional(),
            createdTo: z.string().optional(),
            sort: z.enum(["created_desc", "created_asc", "updated_desc", "updated_asc", "title_asc", "title_desc"]).default("created_desc"),
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
          status: z.enum(["draft", "active", "unlisted", "archived"]).default("draft"),
          descriptionJson: z.unknown().optional(),
          shortDescription: z.string().optional(),
          brandId: z.string().uuid().optional(),
          productType: z.string().optional(),
          tags: z.array(z.string()).default([]),
          requiresShipping: z.boolean().default(true),
          isFeatured: z.boolean().default(false),
          priceOnRequest: z.boolean().default(false),
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
                preorderEnabled: z.boolean().default(false),
                preorderShipsOn: z.string().nullable().optional(),
                preorderMessage: z.string().max(200).nullable().optional(),
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
          status: z.enum(["draft", "active", "unlisted", "archived"]).optional(),
          descriptionJson: z.unknown().optional(),
          shortDescription: z.string().optional(),
          brandId: z.string().uuid().nullable().optional(),
          productType: z.string().optional(),
          tags: z.array(z.string()).optional(),
          requiresShipping: z.boolean().optional(),
          isFeatured: z.boolean().optional(),
          priceOnRequest: z.boolean().optional(),
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
          preorderEnabled: z.boolean().optional(),
          preorderShipsOn: z.string().nullable().optional(),
          preorderMessage: z.string().max(200).nullable().optional(),
          imageMediaId: z.string().uuid().nullable().optional(),
        }),
      )
      .output(ProductVariant),
  },

  // Catalog: Categories
  categories: {
    list: oc
      .route({ method: "GET", path: "/admin/categories" })
      .input(
        z
          .object({
            parentId: z.string().uuid().nullable().optional(),
            status: z.enum(["all", "active", "featured", "inactive"]).optional(),
            search: z.string().optional(),
          })
          .optional(),
      )
      .output(z.array(Category)),
    stats: oc
      .route({ method: "GET", path: "/admin/categories/stats" })
      .output(CategoryStats),
    get: oc
      .route({ method: "GET", path: "/admin/categories/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(Category),
    create: oc
      .route({ method: "POST", path: "/admin/categories" })
      .input(
        z.object({
          name: z.string().min(1),
          slug: z.string().optional(),
          description: z.string().max(500).optional(),
          parentId: z.string().uuid().nullable().optional(),
          imageMediaId: z.string().uuid().nullable().optional(),
          position: z.number().int().default(0),
          isActive: z.boolean().default(true),
          isFeatured: z.boolean().default(false),
          seo: CategorySeo.optional(),
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
          description: z.string().max(500).nullable().optional(),
          parentId: z.string().uuid().nullable().optional(),
          imageMediaId: z.string().uuid().nullable().optional(),
          position: z.number().int().optional(),
          isActive: z.boolean().optional(),
          isFeatured: z.boolean().optional(),
          seo: CategorySeo.nullable().optional(),
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
      .input(
        z
          .object({
            status: z.enum(["all", "active", "draft"]).optional(),
            type: z.enum(["all", "manual", "automated"]).optional(),
            search: z.string().optional(),
          })
          .optional(),
      )
      .output(z.array(Collection)),
    stats: oc
      .route({ method: "GET", path: "/admin/collections/stats" })
      .output(CollectionStats),
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
          imageMediaId: z.string().uuid().nullable().optional(),
          type: z.enum(["manual", "automated"]).default("manual"),
          match: z.enum(["all", "any"]).default("all"),
          rules: z.array(CollectionRule).optional(),
          sortOrder: z
            .enum([
              "manual",
              "best_selling",
              "title_asc",
              "title_desc",
              "price_asc",
              "price_desc",
              "created_desc",
              "created_asc",
            ])
            .default("manual"),
          published: z.boolean().default(true),
          indexable: z.boolean().default(false),
          seo: CollectionSeo.optional(),
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
          imageMediaId: z.string().uuid().nullable().optional(),
          type: z.enum(["manual", "automated"]).optional(),
          match: z.enum(["all", "any"]).optional(),
          rules: z.array(CollectionRule).nullable().optional(),
          sortOrder: z
            .enum([
              "manual",
              "best_selling",
              "title_asc",
              "title_desc",
              "price_asc",
              "price_desc",
              "created_desc",
              "created_asc",
            ])
            .optional(),
          published: z.boolean().optional(),
          indexable: z.boolean().optional(),
          seo: CollectionSeo.nullable().optional(),
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
      .input(z.object({ search: z.string().optional() }).optional())
      .output(z.array(Brand)),
    stats: oc
      .route({ method: "GET", path: "/admin/brands/stats" })
      .output(BrandStats),
    get: oc
      .route({ method: "GET", path: "/admin/brands/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(Brand),
    create: oc
      .route({ method: "POST", path: "/admin/brands" })
      .input(
        z.object({
          name: z.string().min(1),
          slug: z.string().optional(),
          logoMediaId: z.string().uuid().nullable().optional(),
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
      .output(z.object({ success: z.boolean(), affectedProducts: z.number().int() })),
  },

  // Catalog: Locations
  locations: {
    list: oc
      .route({ method: "GET", path: "/admin/locations" })
      .input(z.object({ status: z.enum(["all", "active", "inactive"]).optional() }).optional())
      .output(z.array(Location)),
    stats: oc
      .route({ method: "GET", path: "/admin/locations/stats" })
      .output(LocationStats),
    get: oc
      .route({ method: "GET", path: "/admin/locations/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(Location),
    create: oc
      .route({ method: "POST", path: "/admin/locations" })
      .input(
        z.object({
          name: z.string().min(1),
          address: LocationAddress.optional(),
          pincode: z.string().optional(),
          isDefault: z.boolean().default(false),
          isActive: z.boolean().default(true),
        }),
      )
      .output(Location),
    update: oc
      .route({ method: "PATCH", path: "/admin/locations/{id}" })
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(1).optional(),
          address: LocationAddress.nullable().optional(),
          pincode: z.string().nullable().optional(),
          isDefault: z.boolean().optional(),
          isActive: z.boolean().optional(),
        }),
      )
      .output(Location),
    delete: oc
      .route({ method: "DELETE", path: "/admin/locations/{id}" })
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
            stock: z.enum(["in_stock", "low", "out"]).optional(),
            sort: z.enum(["product_asc", "product_desc", "on_hand_desc", "on_hand_asc", "available_desc", "available_asc"]).default("product_asc"),
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
    library: oc
      .route({ method: "GET", path: "/admin/themes/library" })
      .output(z.array(ThemeLibraryItem)),
    preview: oc
      .route({ method: "GET", path: "/admin/themes/{code}/preview" })
      .input(z.object({ code: z.string().min(1).max(80) }))
      .output(
        z.object({
          name: z.string(),
          version: z.number(),
          blocks: z.array(z.unknown()),
          pages: z.record(z.string(), z.array(z.unknown())),
          tokens: z.record(z.string(), z.unknown()),
        }),
      ),
    activate: oc
      .route({ method: "POST", path: "/admin/themes/activate" })
      .input(z.object({ code: z.string().min(1).max(80) }))
      .output(z.object({ code: z.string(), name: z.string(), version: z.number(), pages: z.array(z.string()) })),
  },

  // Pages
  pages: {
    list: oc
      .route({ method: "GET", path: "/admin/pages" })
      .output(z.array(PageItem)),
    get: oc
      .route({ method: "GET", path: "/admin/pages/{id}" })
      .input(z.object({ id: z.string().uuid(), draft: z.boolean().optional() }))
      .output(PageDetail),
    versions: oc
      .route({ method: "GET", path: "/admin/pages/{id}/versions" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.array(PageVersionItem)),
    // Resolves store data (products, collections) for data-driven blocks in the visual editor.
    blockData: oc
      .route({ method: "POST", path: "/admin/pages/block-data" })
      .input(z.object({ blocks: z.array(z.unknown()) }))
      .output(z.object({ data: z.record(z.string(), z.unknown()), media: z.record(z.string(), z.string()) })),
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
            view: z.enum(["all", "unfulfilled", "unpaid", "cod_to_confirm", "rto", "open", "archived"]).default("all"),
            search: z.string().optional(),
            status: z.string().optional(),
            paymentStatus: z.string().optional(),
            fulfillmentStatus: z.string().optional(),
            source: z.string().optional(),
            tag: z.string().optional(),
            /** Cash-on-delivery orders only (payment status cod_*). */
            cod: z.boolean().optional(),
            /** ISO timestamps bounding placedAt (inclusive from, exclusive to). */
            placedFrom: z.string().optional(),
            placedTo: z.string().optional(),
            sort: z.enum(["placed_desc", "placed_asc", "total_desc", "total_asc", "number_desc", "number_asc"]).default("placed_desc"),
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
              /** Name the customer gave at checkout (from the shipping address); null when none was given. */
              customerName: z.string().nullable().optional(),
              status: z.string(),
              paymentStatus: z.string(),
              fulfillmentStatus: z.string(),
              grandTotal: z.number(),
              placedAt: z.string(),
              shipsOn: z.string().nullable().optional(),
              itemsCount: z.number(),
              firstItemTitle: z.string().nullable().optional(),
            }),
          ),
          total: z.number(),
        }),
      ),
    stats: oc
      .route({ method: "GET", path: "/admin/orders/stats" })
      .output(OrderStats),
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
            shipsOn: z.string().nullable().optional(),
            preorderReleasedAt: z.string().nullable().optional(),
            cancelledAt: z.string().nullable().optional(),
            cancelReason: z.string().nullable().optional(),
            tags: z.array(z.string()).default([]),
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
              shipsOn: z.string().nullable().optional(),
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
    estimateDraft: oc
      .route({ method: "POST", path: "/admin/orders/draft/estimate" })
      .input(
        z.object({
          items: z.array(
            z.object({
              variantId: z.string().uuid(),
              quantity: z.number().int().min(1),
              unitPriceOverride: z.number().int().nonnegative().optional(),
            }),
          ),
          shippingAddress: z
            .object({
              state: z.string().optional(),
              pincode: z.string().optional(),
              city: z.string().optional(),
            })
            .optional(),
          manualDiscount: z
            .object({
              type: z.enum(["flat", "percent"]),
              value: z.number().nonnegative(),
            })
            .optional(),
          shippingOverride: z
            .object({
              amount: z.number().int().nonnegative(),
            })
            .optional(),
          shippingMethod: z.string().optional(),
        }),
      )
      .output(
        z.object({
          subtotal: z.number(),
          discountTotal: z.number(),
          shippingTotal: z.number(),
          availableShippingRates: z.array(
            z.object({
              method: z.string(),
              title: z.string(),
              amount: z.number(),
              estimatedDays: z.string().optional(),
            }),
          ),
          tax: z.object({
            isInterState: z.boolean(),
            cgst: z.number(),
            sgst: z.number(),
            igst: z.number(),
            totalTax: z.number(),
          }),
          grandTotal: z.number(),
        }),
      ),
    createDraft: oc
      .route({ method: "POST", path: "/admin/orders/draft" })
      .input(
        z.object({
          customerId: z.string().uuid().nullable().optional(),
          email: z.string().email(),
          phone: z.string().min(5),
          shippingAddress: z.record(z.string(), z.unknown()),
          billingAddress: z.record(z.string(), z.unknown()).optional(),
          items: z.array(
            z.object({
              variantId: z.string().uuid(),
              quantity: z.number().int().min(1),
              unitPriceOverride: z.number().int().nonnegative().optional(),
              unitPriceOverrideReason: z.string().optional(),
            }),
          ),
          manualDiscount: z
            .object({
              type: z.enum(["flat", "percent"]),
              value: z.number().nonnegative(),
              reason: z.string().min(1),
            })
            .optional(),
          shippingOverride: z
            .object({
              amount: z.number().int().nonnegative(),
              reason: z.string().min(1),
            })
            .optional(),
          shippingMethod: z.string().optional(),
          paymentOutcome: z.enum(["paid", "pending", "cod"]).default("pending"),
          paymentReference: z.string().optional(),
          notes: z.string().optional(),
          tags: z.array(z.string()).optional(),
          quoteId: z.string().uuid().optional(),
        }),
      )
      .output(
        z.object({
          orderId: z.string().uuid(),
          orderNumber: z.string(),
          status: z.string(),
          paymentStatus: z.string(),
          subtotal: z.number(),
          discountTotal: z.number(),
          shippingTotal: z.number(),
          taxTotal: z.number(),
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
    confirm: oc
      .route({ method: "POST", path: "/admin/orders/{id}/confirm" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
    advance: oc
      .route({ method: "POST", path: "/admin/orders/{id}/advance" })
      .input(
        z.object({
          id: z.string().uuid(),
          to: z.enum(["shipped", "delivered"]),
          carrier: z.string().trim().max(80).optional(),
          awb: z.string().trim().max(80).optional(),
        }),
      )
      .output(z.object({ success: z.boolean(), status: z.string() })),
  },

  // --- Pre-orders (ORDERS-PREORDERS-PLAN §3.3) ---
  preorders: {
    list: oc
      .route({ method: "GET", path: "/admin/preorders" })
      .input(
        z
          .object({
            view: z.enum(["all", "waiting", "ready", "shipped", "cancelled"]).default("all"),
            search: z.string().optional(),
            page: z.number().int().min(1).default(1),
            pageSize: z.number().int().min(1).max(100).default(50),
            sort: z.enum(["ships_asc", "ships_desc", "placed_asc", "placed_desc"]).default("ships_asc"),
          })
          .optional(),
      )
      .output(
        z.object({
          items: z.array(PreorderListItem),
          total: z.number(),
          page: z.number(),
          pageSize: z.number(),
        }),
      ),
    stats: oc
      .route({ method: "GET", path: "/admin/preorders/stats" })
      .output(PreorderStats),
    changeShipDate: oc
      .route({ method: "POST", path: "/admin/preorders/change-ship-date" })
      .input(
        z.object({
          orderIds: z.array(z.string().uuid()).min(1),
          shipsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
          reason: z.string().max(300).optional(),
        }),
      )
      .output(
        z.object({
          updatedCount: z.number(),
          skippedCount: z.number(),
        }),
      ),
    releaseNow: oc
      .route({ method: "POST", path: "/admin/preorders/release-now" })
      .input(
        z.object({
          id: z.string().uuid(),
        }),
      )
      .output(
        z.object({
          success: z.boolean(),
        }),
      ),
  },

  // --- Returns (ORDERS-RETURNS-PLAN §3.4) ---
  returns: {
    stats: oc.route({ method: "GET", path: "/admin/returns/stats" }).output(AdminReturnStats),
    list: oc
      .route({ method: "GET", path: "/admin/returns" })
      .input(
        z
          .object({
            view: z.enum(["all", "needs_review", "approved", "received", "resolved", "rejected_closed"]).default("all"),
            search: z.string().optional(),
            resolution: z.enum(["refund", "replacement"]).optional(),
            dateFrom: z.string().optional(),
            dateTo: z.string().optional(),
            sort: z.enum(["created_desc", "created_asc", "amount_desc", "amount_asc"]).default("created_desc"),
            page: z.number().int().min(1).default(1),
            pageSize: z.number().int().min(1).max(100).default(50),
          })
          .optional(),
      )
      .output(
        z.object({
          items: z.array(AdminReturnListItem),
          total: z.number().int(),
          page: z.number().int(),
          pageSize: z.number().int(),
        }),
      ),
    get: oc
      .route({ method: "GET", path: "/admin/returns/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(AdminReturnDetail),
    act: oc
      .route({ method: "POST", path: "/admin/returns/{id}/act" })
      .input(
        z.object({
          id: z.string().uuid(),
          action: z.enum(["approve", "reject", "pick_up", "receive", "refund", "replace", "close"]),
          note: z.string().trim().max(500).optional(),
          resolution: z.enum(["refund", "replacement"]).optional(),
          decisionMessage: z.string().trim().max(1000).optional(),
          restock: z.boolean().optional(),
          refundAmount: z.number().int().min(1).optional(),
          refundMethod: z.enum(["upi", "bank_transfer", "cash", "original_payment_method", "other"]).optional(),
          refundReference: z.string().trim().max(100).optional(),
          exchangeNote: z.string().trim().max(500).optional(),
          exchangeOrderId: z.string().uuid().optional(),
        }),
      )
      .output(z.object({ success: z.boolean(), status: z.string() })),
  },

  // --- Return Settings (ORDERS-SETTINGS-PLAN §5) ---
  returnSettings: {
    get: oc.route({ method: "GET", path: "/admin/settings/returns" }).output(ReturnSettings),
    update: oc
      .route({ method: "PUT", path: "/admin/settings/returns" })
      .input(
        z.object({
          acceptReturns: z.boolean().optional(),
          allowExchanges: z.boolean().optional(),
          returnWindowDays: z.number().int().min(1).max(90).optional(),
          reasons: z
            .array(
              z.object({
                id: z.string(),
                label: z.string().trim().min(1).max(60),
                photoRequirement: z.enum(["required", "optional", "not_asked"]),
              }),
            )
            .max(12)
            .optional(),
          instructions: z.string().max(1000).optional(),
          policyText: z.string().max(1000).optional(),
        }),
      )
      .output(ReturnSettings),
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
            /** Customers with more than one order. */
            repeat: z.boolean().optional(),
            acceptsMarketing: z.boolean().optional(),
            createdFrom: z.string().optional(),
            createdTo: z.string().optional(),
            sort: z.enum(["created_desc", "created_asc", "name_asc", "name_desc", "spent_desc", "spent_asc", "orders_desc", "orders_asc"]).default("created_desc"),
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
              phone: z.string().nullable(),
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
            phone: z.string().nullable(),
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
    create: oc
      .route({ method: "POST", path: "/admin/customers" })
      .input(
        z.object({
          name: z.string().min(1),
          email: z.string().email(),
          phone: z.string().optional(),
          tags: z.array(z.string()).optional(),
          note: z.string().optional(),
          address: z
            .object({
              line1: z.string().min(1),
              line2: z.string().optional(),
              city: z.string().min(1),
              stateCode: z.string().min(1),
              pincode: z.string().min(1),
              phone: z.string().optional(),
              name: z.string().optional(),
            })
            .optional(),
        }),
      )
      .output(
        z.object({
          customer: z.object({
            id: z.string().uuid(),
            name: z.string(),
            email: z.string(),
            phone: z.string().nullable(),
            tags: z.array(z.string()),
            note: z.string().nullable().optional(),
          }),
          addressId: z.string().uuid().optional(),
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
            type: z.enum(["percent", "fixed", "free_shipping", "buy_x_get_y"]).optional(),
            sort: z.enum(["created_desc", "created_asc", "title_asc", "title_desc", "used_desc", "used_asc"]).default("created_desc"),
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

  // --- M7 Shipping Settings Admin ---
  shipping: {
    get: oc
      .route({ method: "GET", path: "/admin/settings/shipping" })
      .output(ShippingSettings),
    update: oc
      .route({ method: "PUT", path: "/admin/settings/shipping" })
      .input(UpdateShippingInput)
      .output(
        z.object({
          success: z.boolean(),
          message: z.string(),
        }),
      ),
  },

  // --- Storefront mode: live / coming soon / maintenance / password ---
  storefront: {
    getStatus: oc
      .route({ method: "GET", path: "/admin/storefront/status" })
      .output(StorefrontStatus),
    updateStatus: oc
      .route({ method: "PATCH", path: "/admin/storefront/status" })
      .input(
        z.object({
          mode: z.enum(["live", "coming_soon", "maintenance", "password"]).optional(),
          headline: z.string().trim().max(120).nullable().optional(),
          collectEmails: z.boolean().optional(),
          showCountdown: z.boolean().optional(),
          launchAt: z.string().datetime().nullable().optional(),
          password: z.string().min(6).max(128).nullable().optional(),
        }),
      )
      .output(StorefrontStatus),
  },

  // --- M8 Onboarding Setup Checklist (PLAN §5.2, §8) ---
  onboarding: {
    get: oc
      .route({ method: "GET", path: "/admin/onboarding" })
      .output(
        z.object({
          steps: z.record(z.string(), z.boolean()),
          completedCount: z.number(),
          totalCount: z.number(),
          dismissed: z.boolean(),
          allCompleted: z.boolean(),
        }),
      ),
    dismiss: oc
      .route({ method: "POST", path: "/admin/onboarding/dismiss" })
      .output(z.object({ success: z.boolean() })),
  },

  // --- M8 Merchant Billing & Subscriptions (PLAN §5.1, §6.4, ADR-014) ---
  billing: {
    getSubscription: oc
      .route({ method: "GET", path: "/admin/billing/subscription" })
      .output(
        z.object({
          subscription: z
            .object({
              id: z.string().uuid(),
              status: z.string(),
              interval: z.string(),
              currentPeriodStart: z.string().nullable().optional(),
              currentPeriodEnd: z.string().nullable().optional(),
              provider: z.string(),
            })
            .nullable(),
          plan: z
            .object({
              id: z.string().uuid(),
              code: z.string(),
              name: z.string(),
              priceMonthlyPaise: z.number(),
              priceYearlyPaise: z.number(),
              currency: z.string(),
            })
            .nullable(),
          invoices: z.array(
            z.object({
              id: z.string().uuid(),
              number: z.string(),
              amountPaise: z.number(),
              taxPaise: z.number(),
              status: z.string(),
              issuedAt: z.string(),
              paidAt: z.string().nullable().optional(),
            }),
          ),
          isTrial: z.boolean(),
          daysLeftInTrial: z.number(),
        }),
      ),
    changePlan: oc
      .route({ method: "POST", path: "/admin/billing/plan" })
      .input(
        z.object({
          planCode: z.string(),
          interval: z.enum(["monthly", "yearly"]),
        }),
      )
      .output(
        z.object({
          providerSubscriptionId: z.string(),
          shortUrl: z.string().optional(),
          status: z.string(),
        }),
      ),
  },

  // --- M8 Custom Domains (PLAN §8, ADR-007, ADR-017) ---
  domains: {
    list: oc
      .route({ method: "GET", path: "/admin/domains" })
      .output(
        z.array(
          z.object({
            id: z.string().uuid(),
            hostname: z.string(),
            type: z.string(),
            isPrimary: z.boolean(),
            status: z.string(),
            sslStatus: z.string().nullable().optional(),
            prevalidateTxt: z.boolean().nullable().optional(),
            verification: z
              .object({
                cname: z.string().optional(),
                txt: z
                  .object({
                    name: z.string(),
                    value: z.string(),
                  })
                  .optional(),
              })
              .nullable()
              .optional(),
            createdAt: z.string(),
          }),
        ),
      ),
    add: oc
      .route({ method: "POST", path: "/admin/domains" })
      .input(
        z.object({
          hostname: z.string().min(3).max(253),
          prevalidateTxt: z.boolean().optional(),
        }),
      )
      .output(
        z.object({
          id: z.string().uuid(),
          hostname: z.string(),
          type: z.string(),
          isPrimary: z.boolean(),
          status: z.string(),
          sslStatus: z.string().nullable().optional(),
          prevalidateTxt: z.boolean().nullable().optional(),
          verification: z
            .object({
              cname: z.string().optional(),
              txt: z
                .object({
                  name: z.string(),
                  value: z.string(),
                })
                .optional(),
            })
            .nullable()
            .optional(),
          createdAt: z.string(),
        }),
      ),
    verify: oc
      .route({ method: "POST", path: "/admin/domains/{id}/verify" })
      .input(z.object({ id: z.string().uuid() }))
      .output(
        z.object({
          id: z.string().uuid(),
          hostname: z.string(),
          status: z.string(),
          sslStatus: z.string().nullable().optional(),
        }),
      ),
    setPrimary: oc
      .route({ method: "POST", path: "/admin/domains/{id}/set-primary" })
      .input(z.object({ id: z.string().uuid() }))
      .output(
        z.object({
          success: z.boolean(),
          primaryHostname: z.string(),
        }),
      ),
    remove: oc
      .route({ method: "DELETE", path: "/admin/domains/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
  },

  quotes: {
    stats: oc
      .route({ method: "GET", path: "/admin/quotes/stats" })
      .output(QuoteStats),
    list: oc
      .route({ method: "GET", path: "/admin/quotes" })
      .input(
        z
          .object({
            tab: z.enum(["all", "needs_reply", "quote_sent", "expired", "accepted", "closed"]).default("all"),
            search: z.string().optional(),
            dateRange: z.enum(["any", "7d", "30d", "90d"]).default("any"),
            customerType: z.enum(["all", "account", "guest"]).default("all"),
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .optional(),
      )
      .output(z.object({ items: z.array(QuoteRequest), total: z.number() })),
    get: oc
      .route({ method: "GET", path: "/admin/quotes/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(QuoteRequest),
    updateNote: oc
      .route({ method: "PATCH", path: "/admin/quotes/{id}/note" })
      .input(z.object({ id: z.string().uuid(), adminNote: z.string().max(5000) }))
      .output(QuoteRequest),
    markLost: oc
      .route({ method: "POST", path: "/admin/quotes/{id}/lost" })
      .input(z.object({ id: z.string().uuid(), reason: z.string().optional() }))
      .output(QuoteRequest),
    reopen: oc
      .route({ method: "POST", path: "/admin/quotes/{id}/reopen" })
      .input(z.object({ id: z.string().uuid() }))
      .output(QuoteRequest),
    delete: oc
      .route({ method: "DELETE", path: "/admin/quotes/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
    linkOrder: oc
      .route({ method: "POST", path: "/admin/quotes/{id}/link-order" })
      .input(
        z.object({
          id: z.string().uuid(),
          orderId: z.string().uuid(),
          validDays: z.number().int().min(1).max(90).default(7),
          quoteNote: z.string().optional(),
        }),
      )
      .output(QuoteRequest),
  },

  abandonedCheckouts: {
    stats: oc
      .route({ method: "GET", path: "/admin/abandoned-checkouts/stats" })
      .output(AbandonedCheckoutStats),
    list: oc
      .route({ method: "GET", path: "/admin/abandoned-checkouts" })
      .input(
        z
          .object({
            view: z.enum(["all", "open", "recovered"]).default("all"),
            search: z.string().optional(),
            emailStatus: z.enum(["all", "not_sent", "sent", "failed", "not_applicable"]).default("all"),
            sort: z.enum(["abandoned_desc", "abandoned_asc", "total_desc", "total_asc"]).default("abandoned_desc"),
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .optional(),
      )
      .output(z.object({ items: z.array(AbandonedCheckoutItem), total: z.number().int() })),
  },
};
