import React from "react";
import Link from "next/link";
import { getChannelConsent, getCustomerProfile } from "@bs/domain";
import { ProfileForm } from "@/components/account/ProfileForm.tsx";
import { ChannelConsent } from "@/components/account/ChannelConsent.tsx";
import { accountContext } from "@/server/customer-session.ts";

export default async function AccountProfilePage() {
  const ctx = await accountContext();
  if (!ctx) return null;
  const profile = await getCustomerProfile(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id);
  if (!profile) return null;
  const consent = await getChannelConsent(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id);
  const badge = (ok: boolean) => (
    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? "bg-[var(--brand-soft)]" : "bg-[var(--background)] text-[var(--muted-foreground)]"}`}>{ok ? "Verified" : "Not verified"}</span>
  );
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

      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 sm:p-5" data-testid="profile-verification">
        <h2 className="mb-2 text-base font-bold text-foreground">Contact details</h2>
        <p className="text-sm">
          Mobile number{badge(profile.phoneVerified)}
        </p>
        {profile.emailIsPlaceholder ? null : (
          <p className="mt-1 text-sm">
            Email{badge(profile.emailVerified)}
          </p>
        )}
      </div>

      {consent ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 sm:p-5">
          <h2 className="mb-1 text-base font-bold text-foreground">Messages from this store</h2>
          <p className="mb-3 text-xs text-[var(--muted-foreground)]">Order and delivery messages always come to you. Offers need your yes, and you can change it any time.</p>
          <ChannelConsent sms={consent.sms} whatsapp={consent.whatsapp} updatedAt={consent.updatedAt} />
        </div>
      ) : null}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 sm:p-5">
        <h2 className="mb-1 text-base font-bold text-foreground">Your data</h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          You can ask for a copy of your data, a correction, or deletion of your account.{" "}
          <Link href="/privacy-request" className="font-semibold text-[var(--brand-ink)] hover:opacity-70 transition-opacity">
            Make a request
          </Link>
          . Your password and devices are on the{" "}
          <Link href="/account/security" className="font-semibold text-[var(--brand-ink)] hover:opacity-70 transition-opacity">
            Security
          </Link>{" "}
          page.
        </p>
      </div>
    </div>
  );
}

