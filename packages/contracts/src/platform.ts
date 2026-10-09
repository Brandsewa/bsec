import { oc } from "@orpc/contract";
import { z } from "zod";

export const PlatformTenant = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  planId: z.string().nullable().optional(),
  ownerEmail: z.string().nullable().optional(),
  trialEndsAt: z.string().nullable().optional(),
  suspendedReason: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});
export type PlatformTenant = z.infer<typeof PlatformTenant>;

export const PlatformTenantDetail = z.object({
  overview: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.string(),
    planId: z.string().nullable().optional(),
    tier: z.string(),
    country: z.string().nullable().optional(),
    currency: z.string().nullable().optional(),
    trialEndsAt: z.string().nullable().optional(),
    suspendedReason: z.string().nullable().optional(),
    archivedAt: z.string().nullable().optional(),
    createdAt: z.string(),
    owner: z.object({
      id: z.string(),
      email: z.string(),
      name: z.string().nullable().optional(),
    }).nullable().optional(),
  }),
  domains: z.array(z.object({
    id: z.string(),
    hostname: z.string(),
    type: z.string(),
    isPrimary: z.boolean(),
    status: z.string(),
    sslStatus: z.string().nullable().optional(),
  })),
  members: z.array(z.object({
    id: z.string(),
    userId: z.string(),
    name: z.string().nullable().optional(),
    email: z.string(),
    role: z.string(),
    status: z.string(),
    createdAt: z.string().optional(),
  })),
  billing: z.object({
    subscription: z.object({
      id: z.string(),
      status: z.string(),
      interval: z.string(),
      currentPeriodStart: z.string().optional(),
      currentPeriodEnd: z.string().optional(),
    }).nullable(),
    invoices: z.array(z.object({
      id: z.string(),
      number: z.string(),
      amountPaise: z.number(),
      taxPaise: z.number(),
      status: z.string(),
      issuedAt: z.string(),
    })),
  }),
  usage: z.object({
    productsCount: z.number(),
    ordersCount: z.number(),
    gmvPaise: z.number(),
  }),
  health: z.object({
    failedWebhooksCount: z.number(),
    recentErrors: z.array(z.object({
      id: z.string(),
      provider: z.string(),
      eventId: z.string(),
      error: z.string().nullable().optional(),
      receivedAt: z.string(),
    })),
  }),
  audit: z.array(z.object({
    id: z.string(),
    action: z.string(),
    actorType: z.string(),
    diff: z.any().nullable().optional(),
    createdAt: z.string(),
  })),
  notes: z.array(z.object({
    id: z.string(),
    body: z.string(),
    authorEmail: z.string().nullable().optional(),
    authorName: z.string().nullable().optional(),
    createdAt: z.string(),
  })),
  /** The open (not cancelled, not finished) deletion of this store, if any. */
  deletion: z
    .object({
      id: z.string(),
      step: z.string(),
      scheduledFor: z.string(),
      reason: z.string(),
      error: z.string().nullable(),
      canCancel: z.boolean(),
    })
    .nullable(),
});
export type PlatformTenantDetail = z.infer<typeof PlatformTenantDetail>;

export const PlatformOverviewMetrics = z.object({
  activeStores: z.number(),
  totalStores: z.number(),
  newSignups7d: z.number(),
  newSignups30d: z.number(),
  conversionRatePct: z.number(),
  platformGmvPaise: z.number(),
  ordersToday: z.number(),
  mrrPaise: z.number(),
  failedJobsCount: z.number(),
  webhookErrorsCount: z.number(),
  dbSizeBytes: z.number(),
});
export type PlatformOverviewMetrics = z.infer<typeof PlatformOverviewMetrics>;

export const SupportSessionRecordSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  platformUserId: z.string(),
  impersonatedUserId: z.string().nullable().optional(),
  reason: z.string(),
  ticketRef: z.string(),
  scope: z.enum(["read_only", "write"]),
  consent: z.enum(["owner_approved", "standing_consent", "emergency"]),
  status: z.enum(["pending_owner_approval", "active", "denied", "ended", "expired"]),
  approvedByUserId: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  startedAt: z.string(),
  expiresAt: z.string(),
  endedAt: z.string().nullable().optional(),
  endedBy: z.string().nullable().optional(),
  actionsCount: z.number(),
  token: z.string().nullable().optional(),
  isExtended: z.boolean(),
  writeConfirmedAt: z.string().nullable().optional(),
});
export type SupportSessionRecordSchema = z.infer<typeof SupportSessionRecordSchema>;

export const PlatformStaffMember = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string().nullable().optional(),
  role: z.string(),
  isActive: z.boolean(),
  mfaRequired: z.boolean(),
  twoFactorEnabled: z.boolean(),
  createdAt: z.string(),
});
export type PlatformStaffMember = z.infer<typeof PlatformStaffMember>;

export const PlatformAuditLog = z.object({
  id: z.string(),
  actorUserId: z.string().nullable().optional(),
  actorEmail: z.string().nullable().optional(),
  actorType: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  tenantId: z.string().nullable().optional(),
  ip: z.string().nullable().optional(),
  diff: z.any().nullable().optional(),
  createdAt: z.string(),
});
export type PlatformAuditLog = z.infer<typeof PlatformAuditLog>;

export const PlatformSystemDataSchema = z.object({
  queues: z.array(z.object({
    queue: z.string(),
    depth: z.number(),
    active: z.number(),
    completed: z.number(),
    failed: z.number(),
  })),
  failedJobs: z.array(z.object({
    id: z.string(),
    name: z.string(),
    data: z.any(),
    output: z.any().optional(),
    retryCount: z.number(),
    createdOn: z.string(),
  })),
  webhookSummary: z.object({
    received: z.number(),
    processing: z.number(),
    processed: z.number(),
    failed: z.number(),
  }),
  failedWebhooks: z.array(z.object({
    id: z.string(),
    provider: z.string(),
    eventId: z.string(),
    tenantId: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    attempts: z.number(),
    receivedAt: z.string(),
  })),
  backups: z.object({
    lastBackupAt: z.string().nullable(),
    lastRestoreTestAt: z.string().nullable(),
    rpoTargetMinutes: z.number(),
    rtoTargetHours: z.number(),
    status: z.enum(["healthy", "warning"]),
  }),
  featureFlags: z.array(z.object({
    key: z.string(),
    defaultOn: z.boolean(),
    killSwitch: z.boolean(),
  })),
});
export type PlatformSystemDataSchema = z.infer<typeof PlatformSystemDataSchema>;

export const platformOverviewContract = {
  get: oc
    .route({ method: "GET", path: "/platform/overview" })
    .output(PlatformOverviewMetrics),
};

export const platformTenantsContract = {
  list: oc
    .route({ method: "GET", path: "/platform/tenants" })
    .input(
      z.object({
        search: z.string().optional(),
        status: z.string().optional(),
        planId: z.string().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      }).optional(),
    )
    .output(z.array(PlatformTenant)),
  get: oc
    .route({ method: "GET", path: "/platform/tenants/{id}" })
    .input(z.object({ id: z.string().uuid() }))
    .output(PlatformTenant),
  getDetail: oc
    .route({ method: "GET", path: "/platform/tenants/{id}/detail" })
    .input(z.object({ id: z.string().uuid() }))
    .output(PlatformTenantDetail),
  create: oc
    .route({ method: "POST", path: "/platform/tenants" })
    .input(
      z.object({
        storeName: z.string().min(1),
        slug: z.string().min(3).max(63),
        clientEmail: z.string().email(),
        clientName: z.string().optional(),
        clientPhone: z.string().optional(),
        planCode: z.enum(["starter", "growth", "pro"]).default("growth"),
        themeTemplate: z.string().default("starter-minimal"),
        state: z.enum(["trial", "comped", "active"]).default("trial"),
        customDomain: z.string().optional(),
      }),
    )
    .output(
      z.object({
        tenantId: z.string(),
        slug: z.string(),
        hostname: z.string(),
        storeUrl: z.string(),
        adminUrl: z.string(),
        inviteToken: z.string(),
        inviteUrl: z.string(),
        /** Present when a custom domain was requested with the store. */
        customDomain: z
          .object({
            hostname: z.string(),
            status: z.string(),
            /** Why it could not be added (the store itself was created regardless). */
            error: z.string().nullable(),
          })
          .optional(),
      }),
    ),
  resendOwnerInvite: oc
    .route({ method: "POST", path: "/platform/tenants/{id}/resend-invite" })
    .input(z.object({ id: z.string().uuid(), email: z.string().email().optional() }))
    .output(
      z.object({
        inviteId: z.string(),
        tenantId: z.string(),
        email: z.string(),
        inviteToken: z.string(),
        inviteUrl: z.string(),
      }),
    ),
  suspend: oc
    .route({ method: "POST", path: "/platform/tenants/{id}/suspend" })
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
    .output(z.object({ ok: z.boolean(), status: z.string() })),
  restore: oc
    .route({ method: "POST", path: "/platform/tenants/{id}/restore" })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ ok: z.boolean(), status: z.string() })),
  archive: oc
    .route({ method: "POST", path: "/platform/tenants/{id}/archive" })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ ok: z.boolean(), status: z.string() })),
  changePlan: oc
    .route({ method: "POST", path: "/platform/tenants/{id}/change-plan" })
    .input(z.object({ id: z.string().uuid(), planCode: z.string() }))
    .output(z.object({ ok: z.boolean(), planCode: z.string() })),
  extendTrial: oc
    .route({ method: "POST", path: "/platform/tenants/{id}/extend-trial" })
    .input(z.object({ id: z.string().uuid(), additionalDays: z.number().int().min(1) }))
    .output(z.object({ ok: z.boolean(), trialEndsAt: z.string() })),
  transferOwnership: oc
    .route({ method: "POST", path: "/platform/tenants/{id}/transfer-ownership" })
    .input(z.object({ id: z.string().uuid(), newOwnerEmail: z.string().email() }))
    .output(z.object({ ok: z.boolean(), newOwnerUserId: z.string(), newOwnerEmail: z.string() })),
  addNote: oc
    .route({ method: "POST", path: "/platform/tenants/{id}/notes" })
    .input(z.object({ id: z.string().uuid(), body: z.string().min(1) }))
    .output(z.object({ ok: z.boolean(), id: z.string(), createdAt: z.string() })),
  bulkSuspend: oc
    .route({ method: "POST", path: "/platform/tenants/bulk-suspend" })
    .input(z.object({ tenantIds: z.array(z.string().uuid()).min(1), reason: z.string().min(1), confirmation: z.string() }))
    .output(z.object({ ok: z.boolean(), suspendedCount: z.number() })),
  bulkChangeTier: oc
    .route({ method: "POST", path: "/platform/tenants/bulk-tier" })
    .input(z.object({
      tenantIds: z.array(z.string().uuid()).min(1),
      tier: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/, "Tier code must be alphanumeric").transform((v) => v.toUpperCase()),
      confirmation: z.string(),
    }))
    .output(z.object({ ok: z.boolean(), updatedCount: z.number(), tier: z.string() })),
  requestDeletion: oc
    .route({ method: "POST", path: "/platform/tenants/{id}/request-deletion" })
    .input(z.object({ id: z.string().uuid(), reason: z.string().optional(), graceDays: z.number().int().min(0).max(90).optional(), confirmSlug: z.string().min(1) }))
    .output(z.object({ ok: z.boolean(), deletionId: z.string(), scheduledFor: z.string() })),
  cancelDeletion: oc
    .route({ method: "POST", path: "/platform/tenants/{id}/cancel-deletion" })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() })),
  export: oc
    .route({ method: "POST", path: "/platform/tenants/{id}/export" })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({
      id: z.string(),
      tenantId: z.string(),
      type: z.string(),
      status: z.string(),
      downloadUrl: z.string().nullable().optional(),
      expiresAt: z.string(),
    })),
};

export const platformDomainsContract = {
  list: oc
    .route({ method: "GET", path: "/platform/domains" })
    .input(z.object({ search: z.string().optional(), limit: z.number().int().optional(), offset: z.number().int().optional() }).optional())
    .output(z.array(z.object({
      id: z.string(),
      tenantId: z.string(),
      tenantName: z.string().optional(),
      tenantSlug: z.string().optional(),
      hostname: z.string(),
      type: z.string(),
      isPrimary: z.boolean(),
      status: z.string(),
      sslStatus: z.string().nullable().optional(),
      failureReason: z.string().nullable().optional(),
      createdAt: z.string(),
    }))),
};

export const platformPlansContract = {
  list: oc
    .route({ method: "GET", path: "/platform/plans" })
    .output(z.array(z.object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
      priceMonthlyPaise: z.number(),
      priceYearlyPaise: z.number(),
      activeSubscribersCount: z.number(),
      features: z.any(),
    }))),
  invoices: oc
    .route({ method: "GET", path: "/platform/plans/invoices" })
    .input(z.object({ limit: z.number().int().optional(), offset: z.number().int().optional() }).optional())
    .output(z.array(z.object({
      id: z.string(),
      tenantId: z.string(),
      tenantName: z.string().optional(),
      number: z.string(),
      amountPaise: z.number(),
      taxPaise: z.number(),
      status: z.string(),
      issuedAt: z.string(),
    }))),
  listRequests: oc
    .route({ method: "GET", path: "/platform/plans/requests" })
    .input(z.object({ status: z.enum(["open", "approved", "declined", "cancelled"]).optional() }).optional())
    .output(
      z.array(
        z.object({
          id: z.string().uuid(),
          tenantId: z.string().uuid(),
          tenantSlug: z.string(),
          tenantName: z.string(),
          requestedBy: z.string().uuid(),
          requestedByEmail: z.string(),
          fromPlanId: z.string().uuid().nullable().optional(),
          fromPlanCode: z.string().nullable().optional(),
          toPlanId: z.string().uuid(),
          toPlanCode: z.string(),
          toPlanName: z.string(),
          interval: z.enum(["monthly", "yearly"]),
          note: z.string().nullable().optional(),
          status: z.enum(["open", "approved", "declined", "cancelled"]),
          decidedBy: z.string().uuid().nullable().optional(),
          decidedAt: z.string().nullable().optional(),
          decisionNote: z.string().nullable().optional(),
          createdAt: z.string(),
        }),
      ),
    ),
  decideRequest: oc
    .route({ method: "POST", path: "/platform/plans/requests/{id}/decide" })
    .input(
      z.object({
        id: z.string().uuid(),
        decision: z.enum(["approved", "declined"]),
        note: z.string().max(500).optional(),
      }),
    )
    .output(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["approved", "declined"]),
        message: z.string(),
      }),
    ),
};

export const platformSignupsContract = {
  list: oc
    .route({ method: "GET", path: "/platform/signups" })
    .input(z.object({ limit: z.number().int().optional(), offset: z.number().int().optional() }).optional())
    .output(z.array(z.object({
      id: z.string(),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      businessName: z.string().nullable().optional(),
      desiredSlug: z.string().nullable().optional(),
      industry: z.string().nullable().optional(),
      source: z.string().nullable().optional(),
      step: z.string(),
      createdAt: z.string(),
    }))),
};

export const ThemeTemplateSummary = z.object({
  code: z.string(),
  name: z.string(),
  industry: z.string(),
  description: z.string().nullable(),
  features: z.array(z.string()),
  version: z.number(),
  isActive: z.boolean(),
  status: z.enum(["draft", "published", "archived"]),
  hasUnpublishedChanges: z.boolean(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type ThemeTemplateSummary = z.infer<typeof ThemeTemplateSummary>;

export const ThemeTemplateDetail = ThemeTemplateSummary.extend({
  // One block list per page key ("home", plus any landing pages the theme ships).
  draftPages: z.record(z.string(), z.array(z.unknown())),
  draftTokens: z.record(z.string(), z.unknown()),
});
export type ThemeTemplateDetail = z.infer<typeof ThemeTemplateDetail>;

export const platformTemplatesContract = {
  list: oc
    .route({ method: "GET", path: "/platform/templates" })
    .output(z.array(ThemeTemplateSummary)),
  get: oc
    .route({ method: "GET", path: "/platform/templates/{code}" })
    .input(z.object({ code: z.string() }))
    .output(ThemeTemplateDetail),
  create: oc
    .route({ method: "POST", path: "/platform/templates" })
    .input(
      z.object({
        name: z.string().min(1).max(120),
        industry: z.string().max(60).optional(),
        description: z.string().max(500).optional(),
        cloneFromCode: z.string().optional(),
      }),
    )
    .output(ThemeTemplateDetail),
  saveDraft: oc
    .route({ method: "POST", path: "/platform/templates/{code}/draft" })
    .input(
      z.object({
        code: z.string(),
        pages: z.record(z.string(), z.array(z.unknown())),
        tokens: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .output(z.object({ ok: z.literal(true) })),
  publish: oc
    .route({ method: "POST", path: "/platform/templates/{code}/publish" })
    .input(z.object({ code: z.string() }))
    .output(z.object({ version: z.number() })),
  createPreview: oc
    .route({ method: "POST", path: "/platform/templates/{code}/preview" })
    .input(z.object({ code: z.string(), ttlHours: z.number().int().min(1).max(168).optional() }))
    .output(z.object({ code: z.string(), url: z.string(), expiresAt: z.string(), pages: z.array(z.string()) })),
  delete: oc
    .route({ method: "DELETE", path: "/platform/templates/{code}" })
    .input(z.object({ code: z.string() }))
    .output(z.object({ ok: z.literal(true) })),
  updateMeta: oc
    .route({ method: "PATCH", path: "/platform/templates/{code}" })
    .input(
      z.object({
        code: z.string(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(500).nullable().optional(),
        industry: z.string().max(60).optional(),
        features: z.array(z.string().max(80)).max(10).optional(),
        isActive: z.boolean().optional(),
        archived: z.boolean().optional(),
      }),
    )
    .output(ThemeTemplateSummary),
};

export const platformSupportContract = {
  list: oc
    .route({ method: "GET", path: "/platform/support/sessions" })
    .input(z.object({ tenantId: z.string().optional() }).optional())
    .output(z.array(SupportSessionRecordSchema)),
  start: oc
    .route({ method: "POST", path: "/platform/support/sessions" })
    .input(
      z.object({
        tenantId: z.string().uuid(),
        reason: z.string().min(3),
        ticketRef: z.string().min(1),
        scope: z.enum(["read_only", "write"]).default("read_only"),
        consent: z.enum(["owner_approved", "standing_consent", "emergency"]),
        impersonatedUserId: z.string().uuid().optional(),
      }),
    )
    .output(SupportSessionRecordSchema),
  extend: oc
    .route({ method: "POST", path: "/platform/support/sessions/{id}/extend" })
    .input(z.object({ id: z.string().uuid() }))
    .output(SupportSessionRecordSchema),
  elevateWrite: oc
    .route({ method: "POST", path: "/platform/support/sessions/{id}/elevate-write" })
    .input(z.object({ id: z.string().uuid() }))
    .output(SupportSessionRecordSchema),
  end: oc
    .route({ method: "POST", path: "/platform/support/sessions/{id}/end" })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() })),
};

export const platformSystemContract = {
  data: oc
    .route({ method: "GET", path: "/platform/system/data" })
    .output(PlatformSystemDataSchema),
  retryJob: oc
    .route({ method: "POST", path: "/platform/system/jobs/{jobId}/retry" })
    .input(z.object({ jobId: z.string() }))
    .output(z.object({ ok: z.boolean() })),
  retryWebhook: oc
    .route({ method: "POST", path: "/platform/system/webhooks/{webhookId}/retry" })
    .input(z.object({ webhookId: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() })),
};

export const QuotaTierView = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sort: z.number(),
  isActive: z.boolean(),
  priceMonthlyPaise: z.number(),
  priceYearlyPaise: z.number(),
  currency: z.string(),
  isPublic: z.boolean(),
  storeCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QuotaTierView = z.infer<typeof QuotaTierView>;

export const QuotaDefinitionView = z.object({
  key: z.string(),
  description: z.string().nullable(),
  unit: z.string(),
  enforcement: z.enum(["hard", "soft", "notify"]),
  tierXs: z.number(),
  tierS: z.number(),
  tierM: z.number(),
  tierL: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QuotaDefinitionView = z.infer<typeof QuotaDefinitionView>;

export const QuotaTierLimitView = z.object({
  tierCode: z.string(),
  quotaKey: z.string(),
  value: z.number(),
});
export type QuotaTierLimitView = z.infer<typeof QuotaTierLimitView>;

export const QuotaMatrixView = z.object({
  tiers: z.array(QuotaTierView),
  definitions: z.array(QuotaDefinitionView),
  limits: z.array(QuotaTierLimitView),
});
export type QuotaMatrixView = z.infer<typeof QuotaMatrixView>;

export const CreateQuotaTierInput = z.object({
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9_-]+$/, "Code must contain only letters, numbers, hyphens and underscores"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  sort: z.number().int().optional(),
  priceMonthlyPaise: z.number().int().nonnegative().optional(),
  priceYearlyPaise: z.number().int().nonnegative().optional(),
  currency: z.string().default("INR").optional(),
  isPublic: z.boolean().optional(),
});
export type CreateQuotaTierInput = z.infer<typeof CreateQuotaTierInput>;

export const UpdateQuotaTierInput = z.object({
  code: z.string(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  sort: z.number().int().optional(),
  isActive: z.boolean().optional(),
  priceMonthlyPaise: z.number().int().nonnegative().optional(),
  priceYearlyPaise: z.number().int().nonnegative().optional(),
  currency: z.string().optional(),
  isPublic: z.boolean().optional(),
});
export type UpdateQuotaTierInput = z.infer<typeof UpdateQuotaTierInput>;

export const UpdateQuotaLimitsInput = z.object({
  updates: z
    .array(
      z.object({
        tierCode: z.string(),
        quotaKey: z.string(),
        value: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(1000),
});
export type UpdateQuotaLimitsInput = z.infer<typeof UpdateQuotaLimitsInput>;

export const UpdateQuotaDefinitionInput = z.object({
  key: z.string(),
  description: z.string().max(500).nullable().optional(),
  unit: z.string().min(1).max(50).optional(),
  enforcement: z.enum(["hard", "soft", "notify"]).optional(),
});
export type UpdateQuotaDefinitionInput = z.infer<typeof UpdateQuotaDefinitionInput>;

export const platformQuotasContract = {
  list: oc
    .route({ method: "GET", path: "/platform/quotas" })
    .output(
      z.array(
        z.object({
          key: z.string(),
          description: z.string().nullable().optional(),
          unit: z.string(),
          enforcement: z.string(),
          tierXs: z.number(),
          tierS: z.number(),
          tierM: z.number(),
          tierL: z.number(),
        }),
      ),
    ),
  matrix: oc
    .route({ method: "GET", path: "/platform/quotas/matrix" })
    .output(QuotaMatrixView),
  createTier: oc
    .route({ method: "POST", path: "/platform/quotas/tiers" })
    .input(CreateQuotaTierInput)
    .output(z.object({ ok: z.boolean(), code: z.string() })),
  updateTier: oc
    .route({ method: "PATCH", path: "/platform/quotas/tiers/{code}" })
    .input(UpdateQuotaTierInput)
    .output(z.object({ ok: z.boolean() })),
  deactivateTier: oc
    .route({ method: "POST", path: "/platform/quotas/tiers/{code}/deactivate" })
    .input(z.object({ code: z.string() }))
    .output(z.object({ ok: z.boolean() })),
  updateLimits: oc
    .route({ method: "POST", path: "/platform/quotas/limits/batch" })
    .input(UpdateQuotaLimitsInput)
    .output(z.object({ ok: z.boolean(), updatedCount: z.number() })),
  updateDefinition: oc
    .route({ method: "PATCH", path: "/platform/quotas/definitions/{key}" })
    .input(UpdateQuotaDefinitionInput)
    .output(z.object({ ok: z.boolean() })),
};

export const platformFeaturesContract = {
  list: oc
    .route({ method: "GET", path: "/platform/features" })
    .output(z.array(z.object({
      key: z.string(),
      defaultOn: z.boolean(),
      killSwitch: z.boolean(),
    }))),
  update: oc
    .route({ method: "POST", path: "/platform/features/{featureKey}" })
    .input(z.object({ featureKey: z.string(), defaultOn: z.boolean(), killSwitch: z.boolean().optional() }))
    .output(z.object({ ok: z.boolean() })),
};

export const platformStaffContract = {
  list: oc
    .route({ method: "GET", path: "/platform/staff" })
    .output(z.array(PlatformStaffMember)),
  invite: oc
    .route({ method: "POST", path: "/platform/staff/invitations" })
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(["platform_owner", "platform_admin", "platform_support"]),
      }),
    )
    .output(
      z.object({
        id: z.string(),
        email: z.string(),
        role: z.string(),
        /** Shown once to the inviter: only its hash is stored. */
        token: z.string(),
        inviteUrl: z.string(),
        expiresAt: z.string(),
      }),
    ),
  updateRole: oc
    .route({ method: "POST", path: "/platform/staff/{userId}/role" })
    .input(
      z.object({
        userId: z.string().uuid(),
        role: z.enum(["platform_owner", "platform_admin", "platform_support"]),
      }),
    )
    .output(z.object({ ok: z.boolean(), targetUserId: z.string(), newRole: z.string() })),
  deactivate: oc
    .route({ method: "POST", path: "/platform/staff/{userId}/deactivate" })
    .input(z.object({ userId: z.string().uuid() }))
    .output(z.object({ ok: z.boolean(), targetUserId: z.string(), isActive: z.boolean() })),
  reactivate: oc
    .route({ method: "POST", path: "/platform/staff/{userId}/reactivate" })
    .input(z.object({ userId: z.string().uuid() }))
    .output(z.object({ ok: z.boolean(), targetUserId: z.string(), isActive: z.boolean() })),
};

export const platformAuditContract = {
  list: oc
    .route({ method: "GET", path: "/platform/audit" })
    .input(
      z.object({
        tenantId: z.string().optional(),
        actorUserId: z.string().optional(),
        action: z.string().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      }).optional(),
    )
    .output(z.array(PlatformAuditLog)),
  exportCsv: oc
    .route({ method: "GET", path: "/platform/audit/export" })
    .input(
      z.object({
        tenantId: z.string().optional(),
        action: z.string().optional(),
      }).optional(),
    )
    .output(z.object({ csv: z.string() })),
};

export const PlatformEmailSettingsView = z.object({
  provider: z.string(),
  host: z.string(),
  port: z.number(),
  secureMode: z.enum(["starttls", "ssl"]),
  username: z.string(),
  passwordConfigured: z.boolean(),
  passwordLastFour: z.string().nullable().optional(),
  fromEmail: z.string(),
  fromName: z.string(),
  replyTo: z.string().nullable().optional(),
  enabled: z.boolean(),
  lastTestAt: z.string().nullable().optional(),
  lastTestStatus: z.string().nullable().optional(),
  lastTestError: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
});
export type PlatformEmailSettingsView = z.infer<typeof PlatformEmailSettingsView>;

export const PlatformEmailLogEntry = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  toEmail: z.string(),
  template: z.string(),
  status: z.string(),
  providerMessageId: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type PlatformEmailLogEntry = z.infer<typeof PlatformEmailLogEntry>;

export const platformEmailContract = {
  get: oc
    .route({ method: "GET", path: "/platform/email/settings" })
    .output(PlatformEmailSettingsView),
  update: oc
    .route({ method: "POST", path: "/platform/email/settings" })
    .input(
      z.object({
        provider: z.string().default("zoho_zeptomail"),
        host: z.string(),
        port: z.number().int(),
        secureMode: z.enum(["starttls", "ssl"]),
        username: z.string(),
        password: z.string().optional(), // write-only, optional on update if already saved
        fromEmail: z.string().email(),
        fromName: z.string(),
        replyTo: z.string().email().nullable().optional().or(z.literal("")),
        enabled: z.boolean(),
      }),
    )
    .output(z.object({ ok: z.boolean() })),
  sendTest: oc
    .route({ method: "POST", path: "/platform/email/test" })
    .input(
      z.object({
        toEmail: z.string().email(),
      }),
    )
    .output(
      z.object({
        ok: z.boolean(),
        status: z.string(),
        error: z.string().optional(),
        messageId: z.string().optional(),
      }),
    ),
  recentDeliveries: oc
    .route({ method: "GET", path: "/platform/email/deliveries" })
    .input(
      z.object({
        failedOnly: z.boolean().optional(),
        limit: z.number().int().optional(),
      }).optional(),
    )
    .output(z.array(PlatformEmailLogEntry)),
};

export const PlatformStorageConnectionView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  driver: z.enum(["local", "r2", "s3"]),
  purpose: z.enum(["public_media", "private_files"]),
  isActive: z.boolean(),
  status: z.enum(["untested", "ok", "failed"]),
  lastTestAt: z.string().nullable().optional(),
  lastTestError: z.string().nullable().optional(),
  endpoint: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  bucket: z.string().nullable().optional(),
  publicBaseUrl: z.string().nullable().optional(),
  forcePathStyle: z.boolean().optional(),
  localDir: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  directBrowserUpload: z.boolean().optional(),
  hasAccessKey: z.boolean(),
  accessKeyIdLast4: z.string().nullable().optional(),
  hasSecretAccessKey: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PlatformStorageConnectionView = z.infer<typeof PlatformStorageConnectionView>;

export const CreatePlatformStorageConnectionInput = z.object({
  name: z.string().min(1).max(100),
  driver: z.enum(["local", "r2", "s3"]),
  purpose: z.enum(["public_media", "private_files"]),
  endpoint: z.string().optional(),
  region: z.string().optional(),
  bucket: z.string().optional(),
  publicBaseUrl: z.string().optional(),
  forcePathStyle: z.boolean().optional(),
  localDir: z.string().optional(),
  accountId: z.string().optional(),
  directBrowserUpload: z.boolean().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
});
export type CreatePlatformStorageConnectionInput = z.infer<typeof CreatePlatformStorageConnectionInput>;

export const UpdatePlatformStorageConnectionInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  driver: z.enum(["local", "r2", "s3"]).optional(),
  purpose: z.enum(["public_media", "private_files"]).optional(),
  endpoint: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  bucket: z.string().nullable().optional(),
  publicBaseUrl: z.string().nullable().optional(),
  forcePathStyle: z.boolean().optional(),
  localDir: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  directBrowserUpload: z.boolean().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
});
export type UpdatePlatformStorageConnectionInput = z.infer<typeof UpdatePlatformStorageConnectionInput>;

export const PlatformStorageStatsView = z.object({
  totalBytes: z.number(),
  totalFiles: z.number(),
  byConnection: z.array(
    z.object({
      connectionId: z.string().nullable(),
      connectionName: z.string().nullable(),
      bytes: z.number(),
      files: z.number(),
    }),
  ),
  topTenants: z.array(
    z.object({
      tenantId: z.string().nullable(),
      tenantName: z.string(),
      bytes: z.number(),
      files: z.number(),
    }),
  ),
});
export type PlatformStorageStatsView = z.infer<typeof PlatformStorageStatsView>;

export const platformStorageContract = {
  list: oc
    .route({ method: "GET", path: "/platform/storage/connections" })
    .output(z.array(PlatformStorageConnectionView)),
  stats: oc
    .route({ method: "GET", path: "/platform/storage/stats" })
    .output(PlatformStorageStatsView),
  get: oc
    .route({ method: "GET", path: "/platform/storage/connections/{id}" })
    .input(z.object({ id: z.string().uuid() }))
    .output(PlatformStorageConnectionView),
  create: oc
    .route({ method: "POST", path: "/platform/storage/connections" })
    .input(CreatePlatformStorageConnectionInput)
    .output(z.object({ id: z.string().uuid(), ok: z.boolean() })),
  update: oc
    .route({ method: "PATCH", path: "/platform/storage/connections/{id}" })
    .input(UpdatePlatformStorageConnectionInput)
    .output(z.object({ ok: z.boolean() })),
  activate: oc
    .route({ method: "POST", path: "/platform/storage/connections/{id}/activate" })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() })),
  test: oc
    .route({ method: "POST", path: "/platform/storage/connections/{id}/test" })
    .input(z.object({ id: z.string().uuid() }))
    .output(
      z.object({
        ok: z.boolean(),
        status: z.string(),
        error: z.string().optional(),
        corsOk: z.boolean().optional(),
        corsDetails: z.string().optional(),
      }),
    ),
  delete: oc
    .route({ method: "DELETE", path: "/platform/storage/connections/{id}" })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() })),
};

export const PlatformIntegrationsOverview = z.object({
  channels: z.object({
    email: z.object({
      status: z.enum(["active", "not_configured", "failing"]),
      sent7d: z.number(),
      failed7d: z.number(),
      provider: z.string().nullable(),
    }),
    sms: z.object({
      status: z.enum(["active", "not_configured", "not_enrolled", "failing"]),
      sent7d: z.number(),
      failed7d: z.number(),
      provider: z.string().nullable(),
    }),
    whatsapp: z.object({
      status: z.enum(["active", "not_configured", "not_enrolled", "failing"]),
      sent7d: z.number(),
      failed7d: z.number(),
      provider: z.string().nullable(),
    }),
  }),
  storage: z.object({
    activeConnections: z.number(),
    totalBytes: z.number(),
    totalFiles: z.number(),
  }),
  payments: z.object({
    enabledProviders: z.array(z.string()),
    totalConnectedStores: z.number(),
  }),
});
export type PlatformIntegrationsOverview = z.infer<typeof PlatformIntegrationsOverview>;

export const ChannelStatsView = z.object({
  channel: z.enum(["email", "sms", "whatsapp"]),
  range: z.enum(["24h", "7d", "30d"]),
  sent: z.number(),
  failed: z.number(),
  skipped: z.number(),
  total: z.number(),
  successRate: z.number(),
  daily: z.array(
    z.object({
      date: z.string(),
      sent: z.number(),
      failed: z.number(),
      skipped: z.number(),
    }),
  ),
});
export type ChannelStatsView = z.infer<typeof ChannelStatsView>;

export const ChannelTransactionEntry = z.object({
  id: z.string(),
  channel: z.enum(["email", "sms", "whatsapp"]),
  createdAt: z.string(),
  recipient: z.string(),
  template: z.string(),
  tenantId: z.string().nullable().optional(),
  tenantName: z.string().nullable().optional(),
  status: z.enum(["sent", "failed", "skipped"]),
  provider: z.string().nullable().optional(),
  providerMessageId: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
export type ChannelTransactionEntry = z.infer<typeof ChannelTransactionEntry>;

export const ChannelTransactionsView = z.object({
  items: z.array(ChannelTransactionEntry),
  total: z.number(),
});
export type ChannelTransactionsView = z.infer<typeof ChannelTransactionsView>;

export const PlatformChannelProviderView = z.object({
  id: z.string(),
  channel: z.enum(["sms", "whatsapp"]),
  provider: z.string(),
  displayName: z.string(),
  config: z.record(z.string(), z.unknown()),
  hasSecret: z.boolean(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  lastTestAt: z.string().nullable().optional(),
  lastTestStatus: z.string().nullable().optional(),
  lastTestError: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PlatformChannelProviderView = z.infer<typeof PlatformChannelProviderView>;

export const CreatePlatformChannelProviderInput = z.object({
  channel: z.enum(["sms", "whatsapp"]),
  provider: z.literal("zoho_cpaas"),
  displayName: z.string().min(1).max(100),
  config: z.record(z.string(), z.unknown()).default({}),
  secret: z.string().optional(),
  enabled: z.boolean().default(false),
  isDefault: z.boolean().default(false),
});
export type CreatePlatformChannelProviderInput = z.infer<typeof CreatePlatformChannelProviderInput>;

export const UpdatePlatformChannelProviderInput = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(100).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  secret: z.string().optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});
export type UpdatePlatformChannelProviderInput = z.infer<typeof UpdatePlatformChannelProviderInput>;

export const PlatformPaymentProviderView = z.object({
  provider: z.enum(["razorpay", "stripe"]),
  displayName: z.string(),
  enabled: z.boolean(),
  liveModeAllowed: z.boolean(),
  connectedStores: z.number(),
  activeStores: z.number(),
  updatedAt: z.string(),
});
export type PlatformPaymentProviderView = z.infer<typeof PlatformPaymentProviderView>;

export const platformIntegrationsContract = {
  paymentProviders: oc
    .route({ method: "GET", path: "/platform/integrations/payments/providers" })
    .output(z.array(PlatformPaymentProviderView)),
  updatePaymentProvider: oc
    .route({ method: "PATCH", path: "/platform/integrations/payments/providers/{provider}" })
    .input(
      z.object({
        provider: z.enum(["razorpay", "stripe"]),
        enabled: z.boolean().optional(),
        liveModeAllowed: z.boolean().optional(),
      }),
    )
    .output(z.object({ ok: z.literal(true) })),
  overview: oc
    .route({ method: "GET", path: "/platform/integrations/overview" })
    .output(PlatformIntegrationsOverview),
  channelStats: oc
    .route({ method: "GET", path: "/platform/integrations/channels/{channel}/stats" })
    .input(
      z.object({
        channel: z.enum(["email", "sms", "whatsapp"]),
        range: z.enum(["24h", "7d", "30d"]).default("7d"),
      }),
    )
    .output(ChannelStatsView),
  channelTransactions: oc
    .route({ method: "GET", path: "/platform/integrations/channels/{channel}/transactions" })
    .input(
      z.object({
        channel: z.enum(["email", "sms", "whatsapp"]),
        status: z.enum(["sent", "failed", "skipped"]).optional(),
        template: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        failedOnly: z.boolean().optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50).optional(),
        offset: z.number().int().min(0).default(0).optional(),
      }),
    )
    .output(ChannelTransactionsView),
  listProviders: oc
    .route({ method: "GET", path: "/platform/integrations/channels/{channel}/providers" })
    .input(z.object({ channel: z.enum(["sms", "whatsapp"]) }))
    .output(z.array(PlatformChannelProviderView)),
  createProvider: oc
    .route({ method: "POST", path: "/platform/integrations/channels/providers" })
    .input(CreatePlatformChannelProviderInput)
    .output(PlatformChannelProviderView),
  updateProvider: oc
    .route({ method: "PATCH", path: "/platform/integrations/channels/providers/{id}" })
    .input(UpdatePlatformChannelProviderInput)
    .output(PlatformChannelProviderView),
  deleteProvider: oc
    .route({ method: "DELETE", path: "/platform/integrations/channels/providers/{id}" })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ success: z.boolean(), id: z.string() })),
  setDefaultProvider: oc
    .route({ method: "POST", path: "/platform/integrations/channels/providers/{id}/default" })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ success: z.boolean() })),
  testProvider: oc
    .route({ method: "POST", path: "/platform/integrations/channels/providers/{id}/test" })
    .input(
      z.object({
        id: z.string().uuid(),
        to: z.string().min(5).max(20),
      }),
    )
    .output(
      z.object({
        ok: z.boolean(),
        error: z.string().nullable().optional(),
        providerMessageId: z.string().nullable().optional(),
      }),
    ),
};
