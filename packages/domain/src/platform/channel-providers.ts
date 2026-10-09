import { and, desc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { encryptSecret, decryptSecret } from "@bs/payments";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta } from "../platform-services.ts";
import { ZohoCPaaSAdapter } from "../system/messaging/zoho-cpaas.ts";
import { maskPhoneNumber } from "../system/messaging/masking.ts";
import type { MessageChannel } from "../system/messaging/types.ts";

export interface CreateChannelProviderInput {
  channel: MessageChannel;
  provider: "zoho_cpaas";
  displayName: string;
  config?: Record<string, unknown> | undefined;
  secret?: string | undefined;
  enabled?: boolean | undefined;
  isDefault?: boolean | undefined;
}

export interface UpdateChannelProviderInput {
  id: string;
  displayName?: string | undefined;
  config?: Record<string, unknown> | undefined;
  secret?: string | undefined;
  enabled?: boolean | undefined;
  isDefault?: boolean | undefined;
}

export interface TestChannelProviderInput {
  id: string;
  to: string; // Destination phone number for test dispatch
}


function shapeProviderView(row: typeof schema.platformChannelProviders.$inferSelect) {
  return {
    id: row.id,
    channel: row.channel as MessageChannel,
    provider: row.provider,
    displayName: row.displayName,
    config: (row.config as Record<string, unknown>) ?? {},
    hasSecret: Boolean(row.secretCiphertext),
    enabled: row.enabled,
    isDefault: row.isDefault,
    lastTestAt: row.lastTestAt ? row.lastTestAt.toISOString() : null,
    lastTestStatus: row.lastTestStatus ?? null,
    lastTestError: row.lastTestError ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Lists channel providers for SMS or WhatsApp. Secrets are NEVER returned.
 */
export async function listPlatformChannelProviders(
  rt: Runtime,
  platformStaffUserId: string,
  channel: MessageChannel,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const rows = await db
    .select()
    .from(schema.platformChannelProviders)
    .where(eq(schema.platformChannelProviders.channel, channel))
    .orderBy(desc(schema.platformChannelProviders.isDefault), desc(schema.platformChannelProviders.createdAt));

  return rows.map(shapeProviderView);
}

/**
 * Creates a platform channel provider.
 * Secrets encrypted via AES-256-GCM.
 */
export async function createPlatformChannelProvider(
  rt: Runtime,
  platformStaffUserId: string,
  input: CreateChannelProviderInput,
  meta?: AuditMeta,
) {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "create channel provider");

  const db = rt._db.db;

  let secretCiphertext: string | null = null;
  let secretIv: string | null = null;
  let secretKeyVersion = 1;

  if (input.secret?.trim()) {
    const enc = encryptSecret(input.secret.trim());
    secretCiphertext = enc.ciphertext;
    secretIv = enc.iv;
    secretKeyVersion = enc.keyVersion;
  }

  // If enabled without credentials, refuse
  if (input.enabled && !secretCiphertext) {
    throw new Error("Cannot enable a channel provider without credentials (must enroll first)");
  }

  return await db.transaction(async (tx) => {
    // If setting as default, clear any existing default for this channel
    if (input.isDefault) {
      await tx
        .update(schema.platformChannelProviders)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(schema.platformChannelProviders.channel, input.channel));
    }

    const [row] = await tx
      .insert(schema.platformChannelProviders)
      .values({
        channel: input.channel,
        provider: input.provider,
        displayName: input.displayName.trim(),
        config: input.config ?? {},
        secretCiphertext,
        secretIv,
        secretKeyVersion,
        enabled: input.enabled ?? false,
        isDefault: input.isDefault ?? false,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create channel provider");
    }

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "channel_provider.create",
      "platform_channel_providers",
      row.id,
      null,
      {
        channel: row.channel,
        provider: row.provider,
        displayName: row.displayName,
        enabled: row.enabled,
        isDefault: row.isDefault,
      },
      meta,
    );

    return shapeProviderView(row);
  });
}

/**
 * Updates a platform channel provider.
 */
export async function updatePlatformChannelProvider(
  rt: Runtime,
  platformStaffUserId: string,
  input: UpdateChannelProviderInput,
  meta?: AuditMeta,
) {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "update channel provider");

  const db = rt._db.db;

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.platformChannelProviders)
      .where(eq(schema.platformChannelProviders.id, input.id))
      .limit(1);

    if (!existing) {
      throw new Error("Channel provider not found");
    }

    let secretCiphertext = existing.secretCiphertext;
    let secretIv = existing.secretIv;
    let secretKeyVersion = existing.secretKeyVersion;

    if (input.secret !== undefined) {
      if (input.secret.trim()) {
        const enc = encryptSecret(input.secret.trim());
        secretCiphertext = enc.ciphertext;
        secretIv = enc.iv;
        secretKeyVersion = enc.keyVersion;
      } else {
        // Explicitly clearing secret
        secretCiphertext = null;
        secretIv = null;
      }
    }

    const enabled = input.enabled ?? existing.enabled;
    if (enabled && !secretCiphertext) {
      throw new Error("Cannot enable a channel provider without credentials (must enroll first)");
    }

    if (input.isDefault) {
      await tx
        .update(schema.platformChannelProviders)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.platformChannelProviders.channel, existing.channel),
            sql`${schema.platformChannelProviders.id} != ${existing.id}`,
          ),
        );
    }

    const [updated] = await tx
      .update(schema.platformChannelProviders)
      .set({
        displayName: input.displayName?.trim() ?? existing.displayName,
        config: input.config ?? existing.config,
        secretCiphertext,
        secretIv,
        secretKeyVersion,
        enabled,
        isDefault: input.isDefault ?? existing.isDefault,
        updatedAt: new Date(),
      })
      .where(eq(schema.platformChannelProviders.id, input.id))
      .returning();

    if (!updated) {
      throw new Error("Failed to update channel provider");
    }

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "channel_provider.update",
      "platform_channel_providers",
      updated.id,
      null,
      {
        before: {
          displayName: existing.displayName,
          enabled: existing.enabled,
          isDefault: existing.isDefault,
        },
        after: {
          displayName: updated.displayName,
          enabled: updated.enabled,
          isDefault: updated.isDefault,
        },
      },
      meta,
    );

    return shapeProviderView(updated);
  });
}

/**
 * Deletes a platform channel provider.
 */
export async function deletePlatformChannelProvider(
  rt: Runtime,
  platformStaffUserId: string,
  id: string,
  meta?: AuditMeta,
) {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "delete channel provider");

  const db = rt._db.db;

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.platformChannelProviders)
      .where(eq(schema.platformChannelProviders.id, id))
      .limit(1);

    if (!existing) {
      throw new Error("Channel provider not found");
    }

    await tx
      .delete(schema.platformChannelProviders)
      .where(eq(schema.platformChannelProviders.id, id));

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "channel_provider.delete",
      "platform_channel_providers",
      id,
      null,
      {
        channel: existing.channel,
        provider: existing.provider,
        displayName: existing.displayName,
      },
      meta,
    );

    return { success: true, id };
  });
}

/**
 * Sets a provider as the default for its channel.
 */
export async function setDefaultPlatformChannelProvider(
  rt: Runtime,
  platformStaffUserId: string,
  id: string,
  meta?: AuditMeta,
) {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "set default channel provider");

  const db = rt._db.db;

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.platformChannelProviders)
      .where(eq(schema.platformChannelProviders.id, id))
      .limit(1);

    if (!existing) {
      throw new Error("Channel provider not found");
    }

    // Clear existing defaults for this channel
    await tx
      .update(schema.platformChannelProviders)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(schema.platformChannelProviders.channel, existing.channel));

    // Set target as default
    await tx
      .update(schema.platformChannelProviders)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(schema.platformChannelProviders.id, id));

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "channel_provider.setDefault",
      "platform_channel_providers",
      id,
      null,
      {
        channel: existing.channel,
        isDefault: true,
      },
      meta,
    );

    return { success: true };
  });
}

/**
 * Runs a test send on the channel provider.
 * Logs result to platform_message_log (with masked recipient, zero body/OTP logging).
 */
export async function testPlatformChannelProvider(
  rt: Runtime,
  platformStaffUserId: string,
  input: TestChannelProviderInput,
  meta?: AuditMeta,
) {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "test channel provider");

  const db = rt._db.db;

  const [providerRow] = await db
    .select()
    .from(schema.platformChannelProviders)
    .where(eq(schema.platformChannelProviders.id, input.id))
    .limit(1);

  if (!providerRow) {
    throw new Error("Channel provider not found");
  }

  let token: string | null = null;
  if (providerRow.secretCiphertext && providerRow.secretIv) {
    try {
      token = decryptSecret({
        ciphertext: providerRow.secretCiphertext,
        iv: providerRow.secretIv,
      });
    } catch {
      token = null;
    }
  }

  const adapter = new ZohoCPaaSAdapter({
    channel: providerRow.channel as MessageChannel,
    token,
    config: (providerRow.config as Record<string, unknown>) ?? {},
  });

  const testResult = await adapter.test({ to: input.to });

  const now = new Date();
  const testStatus = testResult.ok ? "success" : "failed";
  const testError = testResult.error ?? null;

  return await db.transaction(async (tx) => {
    // Insert into platform_message_log (strictly masked)
    await tx.insert(schema.platformMessageLog).values({
      channel: providerRow.channel,
      tenantId: null,
      toMasked: maskPhoneNumber(input.to),
      template: "test_message",
      provider: providerRow.provider,
      status: testResult.ok ? "sent" : "failed",
      providerMessageId: testResult.providerMessageId ?? null,
      error: testError,
      createdAt: now,
    });

    // Update provider record with test result
    await tx
      .update(schema.platformChannelProviders)
      .set({
        lastTestAt: now,
        lastTestStatus: testStatus,
        lastTestError: testError,
        updatedAt: now,
      })
      .where(eq(schema.platformChannelProviders.id, input.id));

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "channel_provider.test",
      "platform_channel_providers",
      input.id,
      null,
      {
        channel: providerRow.channel,
        status: testStatus,
        error: testError,
      },
      meta,
    );

    return {
      ok: testResult.ok,
      error: testError,
      providerMessageId: testResult.providerMessageId ?? null,
    };
  });
}

/**
 * Prunes messages in platform_message_log older than 90 days (worker retention maintenance).
 */
export async function prunePlatformMessageLogs(rt: Runtime): Promise<number> {
  const db = rt._db.db;
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const deleted = await db
    .delete(schema.platformMessageLog)
    .where(sql`${schema.platformMessageLog.createdAt} < ${cutoff}`)
    .returning({ id: schema.platformMessageLog.id });

  return deleted.length;
}
