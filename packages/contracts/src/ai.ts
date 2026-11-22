import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * AI access for stores (ADR-050, docs/MCP-PLAN.md). Mounted under admin.ai.*. Every procedure needs the `ai.manage` permission
 * (owner and admin; never a support session). The AI apps themselves do not use these procedures: they talk to the MCP endpoint.
 */

const Uuid = z.string().uuid();

export const AI_RESOURCES = ["products", "collections", "customers", "orders", "analytics", "finance"] as const;
export const AI_ACTIONS = ["read", "write", "delete"] as const;
export const AiCellKind = z.enum(["toggle", "soon", "na", "locked"]);

const MatrixShape = z.record(z.string(), z.record(z.string(), z.boolean()));

export const AiSettings = z.object({
  /** The store's plan includes AI access (Growth and above). */
  entitled: z.boolean(),
  /** Super Admin has not switched AI access off for this store. */
  available: z.boolean(),
  enabled: z.boolean(),
  matrix: MatrixShape,
  allowPublishing: z.boolean(),
  cells: z.record(z.string(), z.record(z.string(), AiCellKind)),
  consent: z.object({
    currentVersion: z.number().int(),
    acceptedVersion: z.number().int().nullable(),
    acceptedAt: z.string().nullable(),
    accepted: z.boolean(),
    text: z.object({
      title: z.string(),
      intro: z.string(),
      includes: z.array(z.string()),
      notes: z.array(z.string()),
      checkbox: z.string(),
    }),
  }),
  /** The address merchants paste into their AI app. */
  mcpUrl: z.string(),
});
export type AiSettings = z.infer<typeof AiSettings>;

export const AiConnection = z.object({
  id: Uuid,
  clientName: z.string(),
  protocol: z.string(),
  status: z.string(),
  approvedBy: z.object({ name: z.string(), email: z.string() }),
  connectedAt: z.string(),
  lastUsedAt: z.string().nullable(),
  paused: z.boolean(),
});
export type AiConnection = z.infer<typeof AiConnection>;

export const AiUsage = z.object({
  callsToday: z.number().int(),
  writesToday: z.number().int(),
  callLimit: z.number().int(),
  writeLimit: z.number().int(),
  resetsInSeconds: z.number().int(),
});

export const AiActivityEntry = z.object({
  id: Uuid,
  connectionId: Uuid,
  tool: z.string(),
  status: z.string(),
  durationMs: z.number().int(),
  createdAt: z.string(),
});

export const AiChangeEntry = z.object({
  id: Uuid,
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  client: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  createdAt: z.string(),
});

export const AiAuthorizationRequest = z.object({
  clientName: z.string(),
  redirectHost: z.string(),
  loopback: z.boolean(),
  expiresAt: z.string(),
  store: z.object({
    entitled: z.boolean(),
    available: z.boolean(),
    enabled: z.boolean(),
    consentAccepted: z.boolean(),
    /** Plain-language list of what the store's matrix currently lets the app do. */
    abilities: z.array(z.string()),
    refusals: z.array(z.string()),
  }),
});

export const AiSetupCheck = z.object({
  ok: z.boolean(),
  checks: z.array(z.object({ id: z.string(), label: z.string(), ok: z.boolean(), detail: z.string() })),
});

export const aiContract = {
  settings: {
    get: oc.route({ method: "GET", path: "/admin/ai/settings" }).output(AiSettings),
    update: oc
      .route({ method: "PUT", path: "/admin/ai/settings" })
      .input(
        z.object({
          enabled: z.boolean().optional(),
          /** Sent with the consent checkbox ticked; must be the current wording's version. */
          acceptConsentVersion: z.number().int().optional(),
          matrix: MatrixShape.optional(),
          readOnlyPreset: z.boolean().optional(),
          allowPublishing: z.boolean().optional(),
        }),
      )
      .output(AiSettings),
  },
  connections: {
    list: oc.route({ method: "GET", path: "/admin/ai/connections" }).output(z.array(AiConnection)),
    revoke: oc
      .route({ method: "POST", path: "/admin/ai/connections/{id}/revoke" })
      .input(z.object({ id: Uuid }))
      .output(z.object({ revoked: z.literal(true) })),
  },
  usage: oc.route({ method: "GET", path: "/admin/ai/usage" }).output(AiUsage),
  activity: oc
    .route({ method: "GET", path: "/admin/ai/activity" })
    .input(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }))
    .output(z.array(AiActivityEntry)),
  changes: oc
    .route({ method: "GET", path: "/admin/ai/changes" })
    .input(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }))
    .output(z.array(AiChangeEntry)),
  setupCheck: oc.route({ method: "GET", path: "/admin/ai/setup-check" }).output(AiSetupCheck),
  authorization: {
    get: oc
      .route({ method: "GET", path: "/admin/ai/authorization/{requestId}" })
      .input(z.object({ requestId: Uuid }))
      .output(AiAuthorizationRequest),
    approve: oc
      .route({ method: "POST", path: "/admin/ai/authorization/{requestId}/approve" })
      .input(z.object({ requestId: Uuid }))
      .output(z.object({ redirectTo: z.string() })),
    deny: oc
      .route({ method: "POST", path: "/admin/ai/authorization/{requestId}/deny" })
      .input(z.object({ requestId: Uuid }))
      .output(z.object({ redirectTo: z.string() })),
  },
};
