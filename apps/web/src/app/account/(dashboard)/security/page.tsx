import React from "react";
import { cookies } from "next/headers";
import { listCustomerSecurityEvents, listCustomerSessions } from "@bs/domain";
import { CustomerChangePassword } from "@/components/account/CustomerChangePassword.tsx";
import { CustomerSessions } from "@/components/account/CustomerSessions.tsx";
import { LocalTime } from "@/components/account/LocalTime.tsx";
import { CUSTOMER_COOKIE_NAME, accountContext } from "@/server/customer-session.ts";

const EVENT_LABELS: Record<string, string> = {
  sign_in: "Signed in",
  password_changed: "Password changed",
  password_reset: "Password reset",
  session_revoked: "A device was signed out",
  other_sessions_revoked: "Other devices were signed out",
};

export default async function AccountSecurityPage() {
  const ctx = await accountContext();
  if (!ctx) return null;
  const db = ctx.store.rt._db.db;
  const token = (await cookies()).get(CUSTOMER_COOKIE_NAME)?.value;
  const [sessions, events] = await Promise.all([
    listCustomerSessions(db, ctx.store.tenantId, ctx.customer.id, token),
    listCustomerSecurityEvents(db, ctx.store.tenantId, ctx.customer.id),
  ]);
  return (
    <div className="space-y-6" data-testid="account-security">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 sm:p-5">
        <h2 className="mb-1 text-base font-bold text-foreground">Where you are signed in</h2>
        <p className="mb-3 text-xs text-[var(--muted-foreground)]">Sign out any device you do not recognise.</p>
        <CustomerSessions sessions={sessions} />
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 sm:p-5">
        <h2 className="mb-3 text-base font-bold text-foreground">Change password</h2>
        <CustomerChangePassword />
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 sm:p-5">
        <h2 className="mb-1 text-base font-bold text-foreground">Recent activity</h2>
        <p className="mb-3 text-xs text-[var(--muted-foreground)]">If something here was not you, change your password.</p>
        {events.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm first:pt-0 last:pb-0">
                <span className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {e.device} · <LocalTime iso={e.at} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
