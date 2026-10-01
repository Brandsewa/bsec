import { createHash, randomInt } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { type Db, customerOtps, customers, withTenant } from "@bs/db";
import { createCustomerSession } from "./session.ts";

export interface RequestOtpResult {
  success: boolean;
  expiresAt: Date;
  devOtp?: string | undefined;
}

export interface CustomerRecord {
  id: string;
  phone: string | null;
  email: string;
  name: string;
  phoneVerified: boolean;
  emailVerified: boolean;
}

export interface VerifyOtpResult {
  success: boolean;
  customer: CustomerRecord;
  token: string;
}

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp.trim()).digest("hex");
}

export async function requestCustomerOtp(
  db: Db,
  tenantId: string,
  phone: string,
): Promise<RequestOtpResult> {
  const cleanPhone = phone.trim().replace(/\D/g, "");
  // Generate 6 digit OTP
  const rawOtp = String(randomInt(100000, 999999));
  const otpHash = hashOtp(rawOtp);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await withTenant(db, tenantId, async (tx) => {
    await tx.insert(customerOtps).values({
      tenantId,
      phone: cleanPhone,
      otpHash,
      attempts: 0,
      expiresAt,
    });
  });

  return {
    success: true,
    expiresAt,
    devOtp: rawOtp,
  };
}

export async function verifyCustomerOtp(
  db: Db,
  tenantId: string,
  phone: string,
  otp: string,
  meta: { ip?: string | undefined; userAgent?: string | undefined } = {},
): Promise<VerifyOtpResult> {
  const cleanPhone = phone.trim().replace(/\D/g, "");
  const providedHash = hashOtp(otp);

  const outcome = await withTenant(db, tenantId, async (tx): Promise<VerifyOtpResult | { failed: true }> => {
    const [record] = await tx
      .select()
      .from(customerOtps)
      .where(
        and(
          eq(customerOtps.tenantId, tenantId),
          eq(customerOtps.phone, cleanPhone),
          isNull(customerOtps.consumedAt),
          gt(customerOtps.expiresAt, new Date()),
        ),
      )
      .orderBy(sql`${customerOtps.createdAt} DESC`)
      .limit(1);

    if (!record || record.attempts >= 5) {
      return { failed: true };
    }

    if (record.otpHash !== providedHash) {
      // Must commit: throwing inside withTenant would roll the increment back and disable the limit.
      await tx
        .update(customerOtps)
        .set({ attempts: sql`${customerOtps.attempts} + 1` })
        .where(eq(customerOtps.id, record.id));
      return { failed: true };
    }

    // Mark consumed
    await tx
      .update(customerOtps)
      .set({ consumedAt: new Date() })
      .where(eq(customerOtps.id, record.id));

    // Upsert customer
    const [cust] = await tx
      .insert(customers)
      .values({
        tenantId,
        phone: cleanPhone,
        email: `${cleanPhone}@customer.store`,
        name: "",
        phoneVerified: true,
      })
      .onConflictDoUpdate({
        target: [customers.tenantId, customers.phone],
        set: { phoneVerified: true, updatedAt: new Date() },
      })
      .returning();

    if (!cust) {
      throw new Error("Failed to upsert customer");
    }

    const customerRecord: CustomerRecord = {
      id: cust.id,
      phone: cust.phone,
      email: cust.email,
      name: cust.name,
      phoneVerified: cust.phoneVerified,
      emailVerified: cust.emailVerified,
    };

    // The token is an opaque session secret (only its hash is stored); it goes into an httpOnly cookie.
    const { token } = await createCustomerSession(tx, tenantId, cust.id, meta);

    return {
      success: true,
      customer: customerRecord,
      token,
    };
  });

  if ("failed" in outcome) {
    throw new Error("Invalid or expired OTP");
  }
  return outcome;
}
