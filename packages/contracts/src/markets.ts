import { oc } from "@orpc/contract";
import { z } from "zod";

/** Markets (ADR-040, docs/MULTIMARKET-PLAN.md). Admin contract; the storefront has its own small surface in storefront.ts. */
const Uuid = z.string().uuid();
const Currency = z.string().length(3);
const Country = z.string().length(2);
const Rounding = z.enum(["none", "nearest_whole", "charm_99", "charm_95"]);
const UnitSystem = z.enum(["metric", "imperial"]);

export const MarketRecord = z.object({
  id: Uuid,
  name: z.string(),
  handle: z.string(),
  isBase: z.boolean(),
  status: z.enum(["draft", "active", "disabled"]),
  currency: Currency,
  unitSystem: UnitSystem.nullable(),
  fxRate: z.number().nullable(),
  priceAdjustBps: z.number().int(),
  rounding: Rounding,
  taxDisplay: z.enum(["inclusive", "exclusive"]),
  pathPrefix: z.string().nullable(),
  catalogMode: z.enum(["all", "selected"]),
  locale: z.string().nullable(),
  taxCollect: z.boolean(),
  taxShippingToo: z.boolean(),
  complianceAckAt: z.string().nullable(),
  countries: z.array(Country),
});
export type MarketRecord = z.infer<typeof MarketRecord>;

export const MarketReadinessItem = z.object({
  key: z.enum(["currency_rate", "countries", "gateway", "shipping", "policy", "tax_acknowledgement"]),
  ok: z.boolean(),
  message: z.string(),
});

export const MarketTaxRule = z.object({
  country: Country,
  region: z.string().max(10),
  taxName: z.string().min(1).max(40),
  rateBps: z.number().int().min(0).max(10000),
});

export const MarketPolicy = z.object({
  returnSettings: z.record(z.string(), z.unknown()).nullable(),
  cancellation: z.record(z.string(), z.unknown()).nullable(),
  policyText: z.string().max(20000).nullable(),
});

export const MarketDetail = MarketRecord.extend({
  paymentMethods: z.array(z.object({ provider: z.string(), enabled: z.boolean(), sortOrder: z.number().int(), blocking: z.string().nullable(), warning: z.string().nullable() })),
  taxRules: z.array(MarketTaxRule.extend({ id: Uuid })),
  policy: MarketPolicy,
  readiness: z.object({ ready: z.boolean(), items: z.array(MarketReadinessItem) }),
  extraMarketLimit: z.number().int(),
});
export type MarketDetail = z.infer<typeof MarketDetail>;

export const MarketPriceRow = z.object({
  variantId: Uuid,
  productId: Uuid,
  productTitle: z.string(),
  variantTitle: z.string(),
  sku: z.string(),
  basePrice: z.number(),
  baseCompareAtPrice: z.number().nullable(),
  marketPrice: z.number().nullable(),
  marketCompareAtPrice: z.number().nullable(),
  source: z.enum(["derived", "fixed", "missing"]),
});

const IdInput = z.object({ id: Uuid });

export const marketsContract = {
  list: oc
    .route({ method: "GET", path: "/admin/markets" })
    .output(z.object({ markets: z.array(MarketRecord), extraMarketLimit: z.number().int() })),
  get: oc.route({ method: "GET", path: "/admin/markets/{id}" }).input(IdInput).output(MarketDetail),
  create: oc
    .route({ method: "POST", path: "/admin/markets" })
    .input(
      z.object({
        name: z.string().min(1).max(80),
        currency: Currency,
        countries: z.array(Country).min(1).max(250),
        pathPrefix: z.string().max(41).nullable().optional(),
        fxRate: z.number().positive().nullable().optional(),
        priceAdjustBps: z.number().int().optional(),
        rounding: Rounding.optional(),
        taxDisplay: z.enum(["inclusive", "exclusive"]).optional(),
        unitSystem: UnitSystem.nullable().optional(),
      }),
    )
    .output(MarketDetail),
  update: oc
    .route({ method: "PATCH", path: "/admin/markets/{id}" })
    .input(
      z.object({
        id: Uuid,
        name: z.string().min(1).max(80).optional(),
        currency: Currency.optional(),
        fxRate: z.number().positive().nullable().optional(),
        priceAdjustBps: z.number().int().optional(),
        rounding: Rounding.optional(),
        taxDisplay: z.enum(["inclusive", "exclusive"]).optional(),
        unitSystem: UnitSystem.nullable().optional(),
        pathPrefix: z.string().max(41).nullable().optional(),
        catalogMode: z.enum(["all", "selected"]).optional(),
        locale: z.string().max(20).nullable().optional(),
        taxCollect: z.boolean().optional(),
        taxShippingToo: z.boolean().optional(),
      }),
    )
    .output(MarketDetail),
  setCountries: oc
    .route({ method: "PUT", path: "/admin/markets/{id}/countries" })
    .input(z.object({ id: Uuid, countries: z.array(Country).min(1).max(250) }))
    .output(MarketDetail),
  setStatus: oc
    .route({ method: "POST", path: "/admin/markets/{id}/status" })
    .input(z.object({ id: Uuid, status: z.enum(["active", "disabled"]) }))
    .output(MarketDetail),
  delete: oc.route({ method: "DELETE", path: "/admin/markets/{id}" }).input(IdInput).output(z.object({ deleted: z.literal(true) })),
  listPrices: oc
    .route({ method: "GET", path: "/admin/markets/{id}/prices" })
    .input(z.object({ id: Uuid, search: z.string().max(100).optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() }))
    .output(z.object({ rows: z.array(MarketPriceRow), total: z.number().int() })),
  setFixedPrices: oc
    .route({ method: "PUT", path: "/admin/markets/{id}/prices" })
    .input(
      z.object({
        id: Uuid,
        items: z.array(z.object({ variantId: Uuid, price: z.number().int().min(0).nullable(), compareAtPrice: z.number().int().min(0).nullable().optional() })).min(1).max(500),
      }),
    )
    .output(z.object({ updated: z.number().int() })),
  setPaymentMethods: oc
    .route({ method: "PUT", path: "/admin/markets/{id}/payment-methods" })
    .input(z.object({ id: Uuid, methods: z.array(z.object({ provider: z.enum(["cod", "razorpay", "stripe", "paypal", "cashfree"]), enabled: z.boolean() })).max(10) }))
    .output(MarketDetail),
  setPolicy: oc.route({ method: "PUT", path: "/admin/markets/{id}/policy" }).input(z.object({ id: Uuid, policy: MarketPolicy })).output(MarketDetail),
  setTaxRules: oc
    .route({ method: "PUT", path: "/admin/markets/{id}/tax-rules" })
    .input(z.object({ id: Uuid, rules: z.array(MarketTaxRule).max(200) }))
    .output(MarketDetail),
  acknowledgeCompliance: oc.route({ method: "POST", path: "/admin/markets/{id}/acknowledge" }).input(IdInput).output(MarketDetail),
  setProductVisibility: oc
    .route({ method: "PUT", path: "/admin/markets/{id}/catalog" })
    .input(z.object({ id: Uuid, items: z.array(z.object({ productId: Uuid, published: z.boolean() })).min(1).max(500) }))
    .output(z.object({ updated: z.number().int() })),
};
