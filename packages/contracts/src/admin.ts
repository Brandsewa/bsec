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

/** Segment rules (Customers Segments PLAN §3): validated strictly again in the domain service. */
export const SegmentRulesInput = z.object({
  match: z.enum(["all", "any"]),
  conditions: z
    .array(z.object({ field: z.string(), op: z.string(), value: z.unknown() }))
    .min(1)
    .max(10),
});
export type SegmentRulesInput = z.infer<typeof SegmentRulesInput>;

const SegmentSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(["manual", "automatic"]),
  isPreset: z.boolean(),
  memberCount: z.number(),
  countedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const SegmentDetail = SegmentSummary.extend({
  rules: SegmentRulesInput.nullable(),
});

const SegmentCreateInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(200).optional(),
  kind: z.enum(["manual", "automatic"]),
  rules: SegmentRulesInput.optional(),
  isPreset: z.boolean().optional(),
});

export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Curated IANA identifiers for the store timezone selector (V1; the selector is a controlled list,
 * not free text, per the Settings rebuild prompt §D). `Asia/Kolkata` is the platform default.
 */
export const STORE_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Colombo",
  "Asia/Dubai",
  "Asia/Muscat",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Asia/Kuwait",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Manila",
  "Asia/Kuala_Lumpur",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Asia/Tehran",
  "Asia/Jerusalem",
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Zurich",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "America/New_York",
  "America/Toronto",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "UTC",
] as const;

export const STORE_TIMEZONE_SET: ReadonlySet<string> = new Set(STORE_TIMEZONES);

/** The store timezone must be one of the curated IANA identifiers. */
export const StoreTimezone = z.string().refine((v) => STORE_TIMEZONE_SET.has(v), {
  message: "Choose a time zone from the list",
});
export type StoreTimezone = z.infer<typeof StoreTimezone>;

export const StoreAddress = z.object({
  /** ISO 3166-1 alpha-2. V1 is India-only; the editor sends "IN" and the domain defaults it on save. */
  countryCode: z.string().length(2).optional(),
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
  autoPublishReviews: z.boolean().default(false),
  tax: z
    .object({
      gstin: z.string().nullable(),
      sellerState: z.string().nullable(),
      pricesIncludeTax: z.boolean(),
    })
    .optional(),
});
export type StoreSettings = z.infer<typeof StoreSettings>;

/**
 * Server-verified readiness snapshot for the Settings Overview (one narrow read model; the SPA must not
 * query database-like endpoints separately). Facts are derived from the real sources of truth
 * (store_status, store_settings.checkout, shipping zones/rates, products, domains, plans/subscriptions),
 * never from the mere existence of a settings row.
 */
export const SettingsOverviewAction = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  /** Route to fix the condition. Null when no in-app page exists yet (explained in `description`). */
  href: z.string().nullable(),
  kind: z.enum(["required", "informational"]),
});
export type SettingsOverviewAction = z.infer<typeof SettingsOverviewAction>;

export const SettingsOverview = z.object({
  storeStatus: z.object({
    mode: z.enum(["live", "coming_soon", "maintenance", "password"]),
    /** Safe shopper-facing link built from the tenant's primary active domain (or platform subdomain). */
    storefrontUrl: z.string().nullable(),
  }),
  payments: z.object({
    codEnabled: z.boolean(),
    onlinePaymentAvailable: z.boolean(),
  }),
  shipping: z.object({
    hasDefaultRate: z.boolean(),
  }),
  products: z.object({
    hasProducts: z.boolean(),
  }),
  domains: z.object({
    hasCustomDomain: z.boolean(),
    storefrontHostname: z.string().nullable(),
  }),
  /** Null when no plan/subscription data is available; the card is omitted rather than faked. */
  plan: z
    .object({
      name: z.string(),
      status: z.string(),
      interval: z.string(),
    })
    .nullable(),
  onboarding: z.object({
    steps: z.record(z.string(), z.boolean()),
    completedCount: z.number().int(),
    totalCount: z.number().int(),
    dismissed: z.boolean(),
    allCompleted: z.boolean(),
  }),
  actions: z.array(SettingsOverviewAction),
  quickLinks: z.array(
    z.object({
      href: z.string(),
      label: z.string(),
    }),
  ),
});
export type SettingsOverview = z.infer<typeof SettingsOverview>;

export const SettingsActivityDiffEntry = z.object({
  before: z.unknown(),
  after: z.unknown(),
});
export type SettingsActivityDiffEntry = z.infer<typeof SettingsActivityDiffEntry>;

export const SettingsActivityItem = z.object({
  id: z.string().uuid(),
  action: z.string(),
  area: z.string(),
  actorType: z.string(),
  actorId: z.string().uuid().nullable(),
  actorEmail: z.string().nullable(),
  targetType: z.string(),
  targetId: z.string(),
  diff: z.record(z.string(), SettingsActivityDiffEntry).nullable(),
  createdAt: z.string(),
});
export type SettingsActivityItem = z.infer<typeof SettingsActivityItem>;

export const ListSettingsActivityInput = z.object({
  area: z.string().optional(),
  actorId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});
export type ListSettingsActivityInput = z.infer<typeof ListSettingsActivityInput>;
export type ListSettingsActivityArgs = z.input<typeof ListSettingsActivityInput>;

export const ListSettingsActivityOutput = z.object({
  items: z.array(SettingsActivityItem),
  total: z.number().int(),
});
export type ListSettingsActivityOutput = z.infer<typeof ListSettingsActivityOutput>;

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
  returnable: z.boolean().default(true),
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
  primaryCategoryId: z.string().uuid().nullable().optional(),
  primaryCategoryName: z.string().nullable().optional(),
});
export type Product = z.infer<typeof Product>;

export const ProductDetail = Product.extend({
  options: z.array(ProductOption),
  variants: z.array(ProductVariant),
  media: z.array(ProductMedia),
  extraCategoryIds: z.array(z.string().uuid()).default([]),
  collectionIds: z.array(z.string().uuid()).default([]),
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
  /** home, landing, custom, or a theme system page (header, footer, product_template, collection_template, cart_template). */
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

// --- Review Schemas (Phase E) ---
export const Review = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  productTitle: z.string().optional(),
  productSlug: z.string().optional(),
  variantId: z.string().uuid().nullable().optional(),
  variantTitle: z.string().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  orderItemId: z.string().uuid().nullable().optional(),
  reviewerName: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable().optional(),
  body: z.string(),
  status: z.enum(["published", "on_hold"]),
  replyText: z.string().nullable().optional(),
  repliedAt: z.string().nullable().optional(),
  isVerifiedPurchase: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Review = z.infer<typeof Review>;

export const ReviewStats = z.object({
  total: z.number().int(),
  published: z.number().int(),
  onHold: z.number().int(),
  replied: z.number().int(),
  awaitingReply: z.number().int(),
  averageRating: z.number(),
  ratingCounts: z.object({
    5: z.number().int(),
    4: z.number().int(),
    3: z.number().int(),
    2: z.number().int(),
    1: z.number().int(),
  }),
});
export type ReviewStats = z.infer<typeof ReviewStats>;

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
          timezone: StoreTimezone.optional(),
          legalName: z.string().max(200).nullable().optional(),
          supportEmail: z.string().email().nullable().optional(),
          supportPhone: z.string().max(30).nullable().optional(),
          address: StoreAddress.nullable().optional(),
          orderPrefix: z.string().max(10).optional(),
          cod: z.object({ enabled: z.boolean(), feePaise: z.number().int().min(0).max(1_000_000) }).optional(),
          autoPublishReviews: z.boolean().optional(),
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
  // --- Settings Overview (Settings rebuild Phases 0-1, docs/prompts/settings-rebuild-phase-0-1.md §C) ---
  settingsOverview: {
    get: oc
      .route({ method: "GET", path: "/admin/settings/overview" })
      .output(SettingsOverview),
  },
  settingsActivity: {
    list: oc
      .route({ method: "GET", path: "/admin/settings/activity" })
      .input(ListSettingsActivityInput.optional())
      .output(ListSettingsActivityOutput),
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
          returnable: z.boolean().default(true),
          seo: z.unknown().optional(),
          primaryCategoryId: z.string().uuid().optional(),
          extraCategoryIds: z.array(z.string().uuid()).optional(),
          collectionIds: z.array(z.string().uuid()).optional(),
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
          returnable: z.boolean().optional(),
          seo: z.unknown().optional(),
          primaryCategoryId: z.string().uuid().nullable().optional(),
          extraCategoryIds: z.array(z.string().uuid()).optional(),
          collectionIds: z.array(z.string().uuid()).optional(),
        }),
      )
      .output(ProductDetail),
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
      .output(CollectionDetail),
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
      .output(CollectionDetail),
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

  // Reviews (Phase E)
  reviews: {
    list: oc
      .route({ method: "GET", path: "/admin/reviews" })
      .input(
        z
          .object({
            productId: z.string().uuid().optional(),
            status: z.enum(["all", "published", "on_hold", "replied", "awaiting_reply"]).optional(),
            rating: z.number().int().min(1).max(5).optional(),
            search: z.string().optional(),
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .optional(),
      )
      .output(z.object({ items: z.array(Review), total: z.number() })),
    stats: oc
      .route({ method: "GET", path: "/admin/reviews/stats" })
      .input(z.object({ productId: z.string().uuid().optional() }).optional())
      .output(ReviewStats),
    get: oc
      .route({ method: "GET", path: "/admin/reviews/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(Review),
    publish: oc
      .route({ method: "POST", path: "/admin/reviews/{id}/publish" })
      .input(z.object({ id: z.string().uuid() }))
      .output(Review),
    hold: oc
      .route({ method: "POST", path: "/admin/reviews/{id}/hold" })
      .input(z.object({ id: z.string().uuid() }))
      .output(Review),
    delete: oc
      .route({ method: "DELETE", path: "/admin/reviews/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
    reply: oc
      .route({ method: "POST", path: "/admin/reviews/{id}/reply" })
      .input(z.object({ id: z.string().uuid(), replyText: z.string().trim().max(1000) }))
      .output(Review),
    bulkPublish: oc
      .route({ method: "POST", path: "/admin/reviews/bulk-publish" })
      .input(z.object({ ids: z.array(z.string().uuid()).min(1) }))
      .output(z.object({ count: z.number() })),
    bulkHold: oc
      .route({ method: "POST", path: "/admin/reviews/bulk-hold" })
      .input(z.object({ ids: z.array(z.string().uuid()).min(1) }))
      .output(z.object({ count: z.number() })),
    bulkDelete: oc
      .route({ method: "POST", path: "/admin/reviews/bulk-delete" })
      .input(z.object({ ids: z.array(z.string().uuid()).min(1) }))
      .output(z.object({ count: z.number() })),
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

  // --- Customers Admin (Phase 1) ---
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
            /** Tab: every customer, accounts only (not guests), guests only, blocked only. */
            view: z.enum(["all", "accounts", "guests", "blocked"]).default("all"),
            /** Marketing consent state (the Phase 0 single record, not the legacy boolean). */
            marketingState: z.enum(["subscribed", "unsubscribed", "not_subscribed", "invalid"]).optional(),
            /** Kept for compatibility with the pre-Phase-1 page (accepts marketing yes/no). */
            acceptsMarketing: z.boolean().optional(),
            /** State code of the customer's default address. */
            location: z.string().optional(),
            /** Only customers in this segment (Customers Phase 2 integration). */
            segmentId: z.string().uuid().optional(),
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
              isGuest: z.boolean(),
              status: z.string(),
              ordersCount: z.number(),
              totalSpent: z.number(),
              lastOrderAt: z.string().nullable(),
              marketingState: z.string(),
              marketingUpdatedAt: z.string().nullable(),
              tags: z.array(z.string()),
              createdAt: z.string(),
            }),
          ),
          total: z.number(),
        }),
      ),
    /** Counts for the list page's stat strip; every value comes from the Phase 0 metrics fragment. */
    stats: oc
      .route({ method: "GET", path: "/admin/customers/stats" })
      .output(
        z.object({
          total: z.number(),
          newThisMonth: z.number(),
          repeat: z.number(),
          subscribers: z.number(),
          totalSpend: z.number(),
          averageOrderValue: z.number(),
        }),
      ),
    /** Store-wide filter options: every distinct tag and every default-address state, not just those on the current page. */
    tags: oc
      .route({ method: "GET", path: "/admin/customers/tags" })
      .output(z.object({ tags: z.array(z.string()), locationStates: z.array(z.string()) })),
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
            emailVerified: z.boolean(),
            isGuest: z.boolean(),
            status: z.string(),
            ordersCount: z.number(),
            totalSpent: z.number(),
            averageOrderValue: z.number(),
            firstOrderAt: z.string().nullable(),
            lastOrderAt: z.string().nullable(),
            returnsCount: z.number(),
            marketingState: z.string(),
            marketingSource: z.string().nullable(),
            marketingUpdatedAt: z.string().nullable(),
            tags: z.array(z.string()),
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
          consentHistory: z.array(
            z.object({
              id: z.string().uuid(),
              channel: z.string(),
              state: z.string(),
              source: z.string(),
              actorType: z.string(),
              at: z.string(),
            }),
          ),
          recentOrders: z.array(
            z.object({
              id: z.string().uuid(),
              number: z.string(),
              status: z.string(),
              paymentStatus: z.string(),
              fulfillmentStatus: z.string(),
              grandTotal: z.number(),
              placedAt: z.string(),
            }),
          ),
        }),
      ),
    update: oc
      .route({ method: "PATCH", path: "/admin/customers/{id}" })
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().optional(),
          /** Editable only for a guest or an unverified account; a change clears email verification. */
          email: z.string().email().optional(),
          phone: z.string().nullable().optional(),
        }),
      )
      .output(
        z.object({
          id: z.string().uuid(),
          name: z.string(),
          email: z.string(),
          phone: z.string().nullable(),
          emailVerified: z.boolean(),
        }),
      ),
    orders: oc
      .route({ method: "GET", path: "/admin/customers/{id}/orders" })
      .input(
        z.object({
          id: z.string().uuid(),
          status: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .output(
        z.object({
          items: z.array(
            z.object({
              id: z.string().uuid(),
              number: z.string(),
              status: z.string(),
              paymentStatus: z.string(),
              fulfillmentStatus: z.string(),
              grandTotal: z.number(),
              placedAt: z.string(),
            }),
          ),
          total: z.number(),
        }),
      ),
    activity: oc
      .route({ method: "GET", path: "/admin/customers/{id}/activity" })
      .input(
        z.object({
          id: z.string().uuid(),
          limit: z.number().int().min(1).max(200).default(50),
        }),
      )
      .output(
        z.object({
          items: z.array(
            z.object({
              kind: z.enum(["order", "return", "quote", "review", "abandoned_cart", "consent"]),
              at: z.string(),
              title: z.string(),
              detail: z.string().nullable(),
              ref: z.string().nullable(),
            }),
          ),
        }),
      ),
    consentSet: oc
      .route({ method: "POST", path: "/admin/customers/{id}/consent" })
      .input(z.object({ id: z.string().uuid(), state: z.enum(["subscribed", "unsubscribed", "not_subscribed", "invalid"]) }))
      .output(z.object({ id: z.string().uuid(), marketingState: z.string(), acceptsMarketing: z.boolean() })),
    addresses: {
      add: oc
        .route({ method: "POST", path: "/admin/customers/{id}/addresses" })
        .input(
          z.object({
            id: z.string().uuid(),
            address: z.object({
              name: z.string().min(1),
              phone: z.string().min(1),
              line1: z.string().min(1),
              line2: z.string().optional(),
              city: z.string().min(1),
              stateCode: z.string().min(1),
              pincode: z.string().min(1),
              type: z.enum(["home", "work", "other"]).default("home"),
              isDefault: z.boolean().default(false),
            }),
          }),
        )
        .output(z.object({ id: z.string().uuid() })),
      update: oc
        .route({ method: "PATCH", path: "/admin/customers/{id}/addresses/{addressId}" })
        .input(
          z.object({
            id: z.string().uuid(),
            addressId: z.string().uuid(),
            address: z.object({
              name: z.string().min(1),
              phone: z.string().min(1),
              line1: z.string().min(1),
              line2: z.string().optional(),
              city: z.string().min(1),
              stateCode: z.string().min(1),
              pincode: z.string().min(1),
              type: z.enum(["home", "work", "other"]).default("home"),
              isDefault: z.boolean().optional(),
            }),
          }),
        )
        .output(z.object({ success: z.boolean() })),
      delete: oc
        .route({ method: "DELETE", path: "/admin/customers/{id}/addresses/{addressId}" })
        .input(z.object({ id: z.string().uuid(), addressId: z.string().uuid() }))
        .output(z.object({ success: z.boolean() })),
    },
    notes: {
      list: oc
        .route({ method: "GET", path: "/admin/customers/{id}/notes" })
        .input(z.object({ id: z.string().uuid() }))
        .output(
          z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                customerId: z.string().uuid(),
                body: z.string(),
                authorId: z.string().uuid().nullable(),
                authorName: z.string().nullable(),
                createdAt: z.string(),
              }),
            ),
          }),
        ),
      add: oc
        .route({ method: "POST", path: "/admin/customers/{id}/notes" })
        .input(z.object({ id: z.string().uuid(), body: z.string().trim().min(1).max(1000) }))
        .output(z.object({ id: z.string().uuid(), createdAt: z.string() })),
      delete: oc
        .route({ method: "DELETE", path: "/admin/customers/notes/{noteId}" })
        .input(z.object({ noteId: z.string().uuid() }))
        .output(z.object({ success: z.boolean() })),
    },
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
    setStatus: oc
      .route({ method: "POST", path: "/admin/customers/{id}/status" })
      .input(z.object({ id: z.string().uuid(), status: z.enum(["active", "blocked"]) }))
      .output(z.object({ id: z.string().uuid(), status: z.string() })),
    setTags: oc
      .route({ method: "PUT", path: "/admin/customers/{id}/tags" })
      .input(z.object({ id: z.string().uuid(), tags: z.array(z.string()).max(30) }))
      .output(z.object({ id: z.string().uuid(), tags: z.array(z.string()) })),
    /** Dry run for the CSV import: counts and row issues without writing anything. */
    importPreview: oc
      .route({ method: "POST", path: "/admin/customers/import/preview" })
      .input(
        z.object({
          rows: z
            .array(
              z.object({
                name: z.string().optional(),
                email: z.string(),
                phone: z.string().optional(),
                tags: z.array(z.string()).optional(),
                marketingConsent: z.string().optional(),
              }),
            )
            .max(10_000),
        }),
      )
      .output(
        z.object({
          total: z.number(),
          created: z.number(),
          updated: z.number(),
          duplicatesInFile: z.number(),
          subscribeCount: z.number(),
          invalid: z.array(z.object({ row: z.number(), email: z.string(), error: z.string() })),
        }),
      ),
    /** Commits the import; files over 500 rows are queued and the response says so. */
    importCommit: oc
      .route({ method: "POST", path: "/admin/customers/import/commit" })
      .input(
        z.object({
          rows: z
            .array(
              z.object({
                name: z.string().optional(),
                email: z.string(),
                phone: z.string().optional(),
                tags: z.array(z.string()).optional(),
                marketingConsent: z.string().optional(),
              }),
            )
            .max(10_000),
        }),
      )
      .output(
        z.union([
          z.object({ queued: z.literal(true), total: z.number() }),
          z.object({
            queued: z.literal(false).optional(),
            created: z.number(),
            updated: z.number(),
            skipped: z.number(),
            errors: z.array(z.object({ row: z.number(), email: z.string(), error: z.string() })),
          }),
        ]),
      ),
    /**
     * Deletes a customer: hard delete without orders, anonymise with orders
     * (identity replaced, sessions destroyed, orders kept for accounts and tax).
     */
    delete: oc
      .route({ method: "DELETE", path: "/admin/customers/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ id: z.string().uuid(), mode: z.enum(["deleted", "anonymised"]) })),
  },

  // --- Customers Segments (Phase 2) ---
  segments: {
    list: oc
      .route({ method: "GET", path: "/admin/segments" })
      .input(
        z
          .object({
            kind: z.enum(["manual", "automatic"]).optional(),
            limit: z.number().int().min(1).max(100).default(100),
            offset: z.number().int().min(0).default(0),
          })
          .optional(),
      )
      .output(
        z.object({
          items: z.array(SegmentSummary),
          total: z.number(),
        }),
      ),
    get: oc
      .route({ method: "GET", path: "/admin/segments/detail" })
      .input(z.object({ id: z.string().uuid() }))
      .output(SegmentDetail),
    create: oc
      .route({ method: "POST", path: "/admin/segments" })
      .input(SegmentCreateInput)
      .output(SegmentDetail),
    update: oc
      .route({ method: "PATCH", path: "/admin/segments/{id}" })
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().optional(),
          description: z.string().nullable().optional(),
          rules: SegmentRulesInput.optional(),
        }),
      )
      .output(SegmentDetail),
    delete: oc
      .route({ method: "DELETE", path: "/admin/segments/{id}" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ success: z.boolean() })),
    preview: oc
      .route({ method: "POST", path: "/admin/segments/preview" })
      .input(z.object({ rules: SegmentRulesInput }))
      .output(
        z.object({
          count: z.number(),
          sample: z.array(z.object({ id: z.string().uuid(), name: z.string(), email: z.string() })),
        }),
      ),
    members: {
      list: oc
        .route({ method: "GET", path: "/admin/segments/{id}/members" })
        .input(
          z.object({
            id: z.string().uuid(),
            search: z.string().optional(),
            sort: z.enum(["created_desc", "name_asc", "name_desc", "spent_desc", "orders_desc"]).default("created_desc"),
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).default(0),
          }),
        )
        .output(
          z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                email: z.string(),
                phone: z.string().nullable(),
                isGuest: z.boolean(),
                ordersCount: z.number(),
                totalSpent: z.number(),
                lastOrderAt: z.string().nullable(),
                marketingState: z.string(),
                tags: z.array(z.string()),
              }),
            ),
            total: z.number(),
          }),
        ),
      add: oc
        .route({ method: "POST", path: "/admin/segments/{id}/members" })
        .input(
          z.object({
            id: z.string().uuid(),
            customerIds: z.array(z.string().uuid()).max(5000).optional(),
            emails: z.array(z.string()).max(5000).optional(),
          }),
        )
        .output(
          z.object({
            added: z.number(),
            alreadyIn: z.number(),
            notFound: z.array(z.string()),
          }),
        ),
      remove: oc
        .route({ method: "POST", path: "/admin/segments/{id}/members/remove" })
        .input(z.object({ id: z.string().uuid(), customerIds: z.array(z.string().uuid()).max(5000) }))
        .output(z.object({ removed: z.number() })),
    },
    refreshCount: oc
      .route({ method: "POST", path: "/admin/segments/{id}/refresh" })
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ memberCount: z.number(), countedAt: z.string() })),
    forCustomer: oc
      .route({ method: "GET", path: "/admin/segments/for-customer/{customerId}" })
      .input(z.object({ customerId: z.string().uuid() }))
      .output(
        z.object({
          manual: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
          automatic: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
        }),
      ),
    presets: {
      create: oc
        .route({ method: "POST", path: "/admin/segments/presets" })
        .output(z.object({ created: z.number(), skipped: z.number() })),
    },
    activity: oc
      .route({ method: "GET", path: "/admin/segments/{id}/activity" })
      .input(z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }))
      .output(
        z.object({
          items: z.array(
            z.object({
              id: z.string().uuid(),
              action: z.string(),
              actorType: z.string(),
              actorId: z.string().nullable(),
              diff: z.record(z.string(), z.unknown()),
              at: z.string(),
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
