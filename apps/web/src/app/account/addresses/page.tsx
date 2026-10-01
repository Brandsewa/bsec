import React from "react";
import { getCustomerAddresses } from "@bs/domain";
import { AddressBook } from "@/components/account/AddressBook.tsx";
import { accountContext } from "@/server/customer-session.ts";

export default async function AccountAddressesPage() {
  const ctx = await accountContext();
  if (!ctx) return null;
  const addresses = await getCustomerAddresses(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id);
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 className="mb-4 text-lg font-bold text-foreground">Saved addresses</h2>
      <AddressBook
        phone={ctx.customer.phone}
        addresses={addresses.map((a) => ({
          id: a.id,
          name: a.name,
          phone: a.phone,
          line1: a.line1,
          line2: a.line2,
          landmark: a.landmark,
          city: a.city,
          stateCode: a.stateCode,
          pincode: a.pincode,
          type: a.type,
          isDefault: a.isDefault,
        }))}
      />
    </div>
  );
}
