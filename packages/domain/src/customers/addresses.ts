import { and, eq } from "drizzle-orm";
import { type Db, customerAddresses, withTenant } from "@bs/db";

export interface AddressInput {
  name: string;
  phone: string;
  line1: string;
  line2?: string | undefined;
  landmark?: string | undefined;
  city: string;
  stateCode: string;
  pincode: string;
  country?: string | undefined;
  type?: string | undefined;
  isDefault?: boolean | undefined;
}

export interface CustomerAddressRecord {
  id: string;
  customerId: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  stateCode: string;
  pincode: string;
  country: string;
  type: string;
  isDefault: boolean;
}

export async function getCustomerAddresses(
  db: Db,
  tenantId: string,
  customerId: string,
): Promise<CustomerAddressRecord[]> {
  return await withTenant(db, tenantId, async (tx) => {
    return await tx
      .select()
      .from(customerAddresses)
      .where(
        and(
          eq(customerAddresses.tenantId, tenantId),
          eq(customerAddresses.customerId, customerId),
        ),
      );
  });
}

export async function createCustomerAddress(
  db: Db,
  tenantId: string,
  customerId: string,
  data: AddressInput,
): Promise<CustomerAddressRecord> {
  return await withTenant(db, tenantId, async (tx) => {
    if (data.isDefault) {
      await tx
        .update(customerAddresses)
        .set({ isDefault: false })
        .where(
          and(
            eq(customerAddresses.tenantId, tenantId),
            eq(customerAddresses.customerId, customerId),
          ),
        );
    }

    const [created] = await tx
      .insert(customerAddresses)
      .values({
        tenantId,
        customerId,
        name: data.name,
        phone: data.phone,
        line1: data.line1,
        line2: data.line2 ?? null,
        landmark: data.landmark ?? null,
        city: data.city,
        stateCode: data.stateCode,
        pincode: data.pincode,
        country: data.country ?? "IN",
        type: data.type ?? "home",
        isDefault: data.isDefault ?? false,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create customer address");
    }
    return created;
  });
}

export async function deleteCustomerAddress(
  db: Db,
  tenantId: string,
  customerId: string,
  addressId: string,
): Promise<boolean> {
  return await withTenant(db, tenantId, async (tx) => {
    const res = await tx
      .delete(customerAddresses)
      .where(
        and(
          eq(customerAddresses.tenantId, tenantId),
          eq(customerAddresses.customerId, customerId),
          eq(customerAddresses.id, addressId),
        ),
      )
      .returning({ id: customerAddresses.id });

    return res.length > 0;
  });
}
