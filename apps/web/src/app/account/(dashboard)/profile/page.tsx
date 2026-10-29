import React from "react";
import { getCustomerProfile } from "@bs/domain";
import { ProfileForm } from "@/components/account/ProfileForm.tsx";
import { CustomerChangePassword } from "@/components/account/CustomerChangePassword.tsx";
import { accountContext } from "@/server/customer-session.ts";

export default async function AccountProfilePage() {
  const ctx = await accountContext();
  if (!ctx) return null;
  const profile = await getCustomerProfile(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id);
  if (!profile) return null;
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 sm:p-5">
        <h2 className="mb-3 text-base font-bold text-foreground">Your details</h2>
        <ProfileForm
          phone={profile.phone}
          name={profile.name}
          // The placeholder made at sign-in is not a real address: ask for one instead of showing it.
          email={profile.emailIsPlaceholder ? "" : profile.email}
          acceptsMarketing={profile.acceptsMarketing}
        />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 sm:p-5">
        <h2 className="mb-3 text-base font-bold text-foreground">Change password</h2>
        <CustomerChangePassword />
      </div>
    </div>
  );
}

