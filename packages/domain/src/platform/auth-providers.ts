import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import { decryptSecret, encryptSecret } from "@bs/payments";
import type { Runtime } from "../runtime.ts";
import {
  assertPlatformStaff,
  assertRoleAtLeast,
  writePlatformAudit,
  type AuditMeta,
} from "../platform-services.ts";

/**
 * Platform authentication hub (docs/GOOGLE-SIGNIN-PLAN.md, Tier A).
 * The platform Google client is used ONLY for Super Admin, platform staff and store owners/staff signing in
 * or signing up to the platform. A store's customers never sign in through it (Tier B uses the store's own client).
 */

const GOOGLE_CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;

export interface PlatformGoogleView {
  enabled: boolean;
  staffSignupAllowed: boolean;
  customerSigninAllowed: boolean;
  oneTapAllowed: boolean;
  clientId: string | null;
  secretConfigured: boolean;
  lastTestAt: string | null;
  lastTestStatus: "success" | "failed" | null;
  lastTestError: string | null;
  /** Platform users (staff and store owners) who linked a Google account. */
  linkedUsers: number;
  /** Stores that connected their own Google app for customers (Tier B). */
  customerStoresConnected: number;
  updatedAt: string | null;
}

export interface PlatformAuthOverview {
  email: { totalStores: number; storesDisabled: number; mailerConfigured: boolean };
  phone: { totalStores: number; storesDisabled: number };
  google: PlatformGoogleView;
}

export interface PlatformGoogleRuntimeConfig {
  clientId: string;
  clientSecret: string;
  staffSignupAllowed: boolean;
  oneTapAllowed: boolean;
}

/** What the unauthenticated admin/Super Admin/signup pages may know: never the secret. */
export interface PublicGoogleSignin {
  enabled: boolean;
  clientId: string | null;
  oneTap: boolean;
  signupAllowed: boolean;
}

async function readGoogleRows(db: Db) {
  const [provider] = await db
    .select()
    .from(schema.platformAuthProviders)
    .where(eq(schema.platformAuthProviders.provider, "google"))
    .limit(1);
  const [client] = await db
    .select()
    .from(schema.platformGoogleClient)
    .where(eq(schema.platformGoogleClient.id, "default"))
    .limit(1);
  return { provider, client };
}

/** Public, secret-free config for the login and signup pages. Disabled until a verified client exists. */
export async function getPublicGoogleSignin(db: Db): Promise<PublicGoogleSignin> {
  const { provider, client } = await readGoogleRows(db);
  const ready = Boolean(provider?.enabled && client?.clientId && client.secretCiphertext);
  return {
    enabled: ready,
    clientId: ready ? (client?.clientId ?? null) : null,
    oneTap: ready && Boolean(provider?.oneTapAllowed),
    signupAllowed: ready && Boolean(provider?.staffSignupAllowed),
  };
}

/** Decrypted credentials for the Better Auth instances. Null when Google sign-in is off or not configured. */
export async function loadPlatformGoogleRuntimeConfig(db: Db): Promise<PlatformGoogleRuntimeConfig | null> {
  const { provider, client } = await readGoogleRows(db);
  if (!provider?.enabled || !client?.clientId || !client.secretCiphertext || !client.secretIv) return null;
  try {
    const clientSecret = decryptSecret({ ciphertext: client.secretCiphertext, iv: client.secretIv });
    return {
      clientId: client.clientId,
      clientSecret,
      staffSignupAllowed: provider.staffSignupAllowed,
      oneTapAllowed: provider.oneTapAllowed,
    };
  } catch {
    return null;
  }
}

export async function getPlatformAuthOverview(rt: Runtime, platformStaffUserId: string): Promise<PlatformAuthOverview> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const counts = await db.execute<{ total: string; email_off: string; phone_off: string }>(sql`
    SELECT
      (SELECT COUNT(*) FROM tenants)::text AS total,
      (SELECT COUNT(*) FROM customer_account_settings WHERE email_password_enabled = false)::text AS email_off,
      (SELECT COUNT(*) FROM customer_account_settings WHERE phone_otp_enabled = false)::text AS phone_off;
  `);
  const c = counts.rows[0];
  const [mailer] = await db
    .select({ enabled: schema.platformEmailSettings.enabled })
    .from(schema.platformEmailSettings)
    .where(eq(schema.platformEmailSettings.id, "default"))
    .limit(1);

  const { provider, client } = await readGoogleRows(db);
  const linked = await db.execute<{ n: string }>(
    sql`SELECT COUNT(DISTINCT user_id)::text AS n FROM accounts WHERE provider_id = 'google';`,
  );
  // Tier B table arrives with the customer phase; tolerate its absence so this page never breaks.
  let customerStores = 0;
  try {
    const r = await db.execute<{ n: string }>(
      sql`SELECT COUNT(*)::text AS n FROM store_social_auth WHERE provider = 'google' AND enabled = true;`,
    );
    customerStores = Number(r.rows[0]?.n ?? 0);
  } catch {
    /* table not present yet */
  }

  return {
    email: {
      totalStores: Number(c?.total ?? 0),
      storesDisabled: Number(c?.email_off ?? 0),
      mailerConfigured: Boolean(mailer?.enabled),
    },
    phone: { totalStores: Number(c?.total ?? 0), storesDisabled: Number(c?.phone_off ?? 0) },
    google: {
      enabled: provider?.enabled ?? false,
      staffSignupAllowed: provider?.staffSignupAllowed ?? true,
      customerSigninAllowed: provider?.customerSigninAllowed ?? false,
      oneTapAllowed: provider?.oneTapAllowed ?? true,
      clientId: client?.clientId ?? null,
      secretConfigured: Boolean(client?.secretCiphertext && client.secretIv),
      lastTestAt: client?.lastTestAt ? client.lastTestAt.toISOString() : null,
      lastTestStatus: client?.lastTestStatus === "success" || client?.lastTestStatus === "failed" ? client.lastTestStatus : null,
      lastTestError: client?.lastTestError ?? null,
      linkedUsers: Number(linked.rows[0]?.n ?? 0),
      customerStoresConnected: customerStores,
      updatedAt: provider?.updatedAt ? provider.updatedAt.toISOString() : null,
    },
  };
}

export interface UpdateGoogleSettingsInput {
  enabled?: boolean | undefined;
  staffSignupAllowed?: boolean | undefined;
  customerSigninAllowed?: boolean | undefined;
  oneTapAllowed?: boolean | undefined;
}

/**
 * Switches for Google sign-in. Enabling needs a client ID and secret that passed the last test, so the login
 * pages never show a button that cannot work.
 */
export async function updatePlatformGoogleSettings(
  rt: Runtime,
  platformStaffUserId: string,
  input: UpdateGoogleSettingsInput,
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "change Google sign-in");

  return rt._db.db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.platformAuthProviders)
      .where(eq(schema.platformAuthProviders.provider, "google"))
      .for("update")
      .limit(1);
    if (!before) throw new Error('Not Found: unknown auth provider "google"');

    const next = {
      enabled: input.enabled ?? before.enabled,
      staffSignupAllowed: input.staffSignupAllowed ?? before.staffSignupAllowed,
      customerSigninAllowed: input.customerSigninAllowed ?? before.customerSigninAllowed,
      oneTapAllowed: input.oneTapAllowed ?? before.oneTapAllowed,
    };

    if (next.enabled && !before.enabled) {
      const [client] = await tx
        .select()
        .from(schema.platformGoogleClient)
        .where(eq(schema.platformGoogleClient.id, "default"))
        .limit(1);
      if (!client?.clientId || !client.secretCiphertext) {
        throw new Error("Bad Request: add the Google Client ID and Client Secret before enabling Google sign-in");
      }
      if (client.lastTestStatus !== "success") {
        throw new Error("Bad Request: run the connection test successfully before enabling Google sign-in");
      }
    }

    await tx
      .update(schema.platformAuthProviders)
      .set({ ...next, updatedBy: platformStaffUserId, updatedAt: new Date() })
      .where(eq(schema.platformAuthProviders.provider, "google"));

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      next.enabled !== before.enabled
        ? next.enabled
          ? "auth_provider.google.enabled"
          : "auth_provider.google.disabled"
        : "auth_provider.google.updated",
      "auth_provider",
      "google",
      null,
      {
        before: {
          enabled: before.enabled,
          staffSignupAllowed: before.staffSignupAllowed,
          customerSigninAllowed: before.customerSigninAllowed,
          oneTapAllowed: before.oneTapAllowed,
        },
        after: next,
      },
      meta,
    );
    return { ok: true as const };
  });
}

/**
 * Saves the platform Google OAuth client. The secret is encrypted and write-only; leaving it blank keeps the
 * stored one. Any change clears the last test and switches Google sign-in off until it is tested again.
 */
export async function setPlatformGoogleClient(
  rt: Runtime,
  platformStaffUserId: string,
  input: { clientId: string; clientSecret?: string | undefined },
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "change the Google client");

  const clientId = input.clientId.trim();
  if (!GOOGLE_CLIENT_ID_RE.test(clientId)) {
    throw new Error("Bad Request: the Client ID should look like 123456-abc.apps.googleusercontent.com");
  }

  return rt._db.db.transaction(async (tx) => {
    const [prev] = await tx
      .select()
      .from(schema.platformGoogleClient)
      .where(eq(schema.platformGoogleClient.id, "default"))
      .limit(1);

    let secretCiphertext = prev?.secretCiphertext ?? null;
    let secretIv = prev?.secretIv ?? null;
    let keyVersion = prev?.keyVersion ?? 1;
    const newSecret = input.clientSecret?.trim();
    if (newSecret) {
      const enc = encryptSecret(newSecret);
      secretCiphertext = enc.ciphertext;
      secretIv = enc.iv;
      keyVersion = enc.keyVersion;
    }
    if (!secretCiphertext) throw new Error("Bad Request: the Client Secret is required the first time");

    const values = {
      clientId,
      secretCiphertext,
      secretIv,
      keyVersion,
      lastTestAt: null,
      lastTestStatus: null,
      lastTestError: null,
      updatedBy: platformStaffUserId,
      updatedAt: new Date(),
    };
    await tx
      .insert(schema.platformGoogleClient)
      .values({ id: "default", ...values })
      .onConflictDoUpdate({ target: schema.platformGoogleClient.id, set: values });

    // A changed client must be re-tested before it can sign anyone in.
    await tx
      .update(schema.platformAuthProviders)
      .set({ enabled: false, updatedBy: platformStaffUserId, updatedAt: new Date() })
      .where(eq(schema.platformAuthProviders.provider, "google"));

    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "auth_provider.google.client_updated",
      "auth_provider",
      "google",
      null,
      { clientIdChanged: prev?.clientId !== clientId, secretChanged: Boolean(newSecret) },
      meta,
    );
    return { ok: true as const };
  });
}

export type GoogleTokenProbe = (params: { clientId: string; clientSecret: string }) => Promise<{ error?: string; description?: string }>;

/**
 * Asks Google's token endpoint to exchange a deliberately invalid code. With the right ID and secret Google answers
 * `invalid_grant`; with a wrong ID or secret it answers `invalid_client`. That proves the credentials without any
 * user interaction or side effect.
 */
const defaultProbe: GoogleTokenProbe = async ({ clientId, clientSecret }) => {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "bsec-connection-test",
      redirect_uri: "http://localhost/bsec-connection-test",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
  return { ...(body.error ? { error: body.error } : {}), ...(body.error_description ? { description: body.error_description } : {}) };
};

export async function testPlatformGoogleClient(
  rt: Runtime,
  platformStaffUserId: string,
  meta?: AuditMeta,
  probe: GoogleTokenProbe = defaultProbe,
): Promise<{ ok: boolean; error?: string }> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "test the Google client");

  const db = rt._db.db;
  const { client } = await readGoogleRows(db);
  if (!client?.clientId || !client.secretCiphertext || !client.secretIv) {
    return { ok: false, error: "Add the Client ID and Client Secret first." };
  }

  let ok = false;
  let error: string | undefined;
  try {
    const clientSecret = decryptSecret({ ciphertext: client.secretCiphertext, iv: client.secretIv });
    const result = await probe({ clientId: client.clientId, clientSecret });
    if (result.error === "invalid_grant") ok = true;
    else if (result.error === "invalid_client") error = "Google rejected the Client ID or Client Secret. Copy them again from Google Cloud.";
    else error = `Unexpected answer from Google (${result.error ?? "no error"}).`;
  } catch {
    error = "Could not reach Google. Try again in a moment.";
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.platformGoogleClient)
      .set({ lastTestAt: new Date(), lastTestStatus: ok ? "success" : "failed", lastTestError: error ?? null })
      .where(eq(schema.platformGoogleClient.id, "default"));
    await writePlatformAudit(
      tx,
      platformStaffUserId,
      "auth_provider.google.tested",
      "auth_provider",
      "google",
      null,
      { ok },
      meta,
    );
  });
  return ok ? { ok: true } : { ok: false, ...(error ? { error } : {}) };
}
