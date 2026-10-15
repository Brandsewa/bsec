import React from "react";
import Link from "next/link";
import { getCustomerProfile } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";

export default async function AccountNotificationsPage() {
  const ctx = await accountContext();
  if (!ctx) return null;
  const profile = await getCustomerProfile(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id);
  if (!profile) return null;
  return (
    <div className="space-y-3" data-testid="account-notifications">
      <div className="rounded-xl bg-[var(--muted)]/50 p-4">
        <p className="text-sm font-semibold">Order updates</p>
        <p className="text-xs text-[var(--muted-foreground)]">We message you about order confirmation and delivery. These are always on.</p>
      </div>
      <div className="rounded-xl bg-[var(--muted)]/50 p-4">
        <p className="text-sm font-semibold">Offers and news: {profile.acceptsMarketing ? "On" : "Off"}</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Change this on your{" "}
          <Link href="/account/profile" className="font-semibold text-[var(--brand-ink)] hover:underline">
            profile
          </Link>
          .
        </p>
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">An inbox of past messages is not available yet.</p>
    </div>
  );
}
