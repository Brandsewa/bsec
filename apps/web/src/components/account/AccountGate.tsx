import React from "react";
import { notFound } from "next/navigation";
import { AuthShell } from "@bs/ui";
import { LoginForm } from "@/components/account/LoginForm.tsx";
import { AccountNav } from "@/components/account/AccountNav.tsx";
import { LogoutButton } from "@/components/account/LogoutButton.tsx";
import { currentCustomer, resolveStore } from "@/server/customer-session.ts";
import { getCachedStoreName } from "@/server/cached-storefront.ts";

/** Wraps every /account page: shows sign-in for a visitor, the account navigation for a signed-in shopper. */
export async function AccountGate({ children }: { children: React.ReactNode }) {
  const store = await resolveStore();
  if (!store) notFound();
  const customer = await currentCustomer(store);
  const storeName = await getCachedStoreName(store.tenantId).catch(() => "Store");

  if (!customer) {
    return (
      <AuthShell
        variant="store"
        brand={{ name: storeName }}
        title="Sign in"
        description="Access your orders, addresses, and account details."
      >
        <LoginForm />
      </AuthShell>
    );
  }

  const displayName = customer.name || customer.phone || "My account";
  // guest accounts carry a placeholder address that is not worth showing
  const showEmail = Boolean(customer.email) && !customer.email.endsWith("@customer.store");
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join("") || "?";

  // same container as the header and pages: the theme's site width plus the 2.5rem side padding the header row uses
  return (
    <div className="bs-account mx-auto w-full px-4 py-5 sm:px-6 sm:py-8 lg:max-w-[calc(var(--bs-site-w-d,1200px)+5rem)] lg:px-10">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0 lg:sticky lg:top-6 lg:flex lg:h-[calc(100vh-3rem)] lg:max-h-[48rem] lg:flex-col lg:self-start lg:rounded-lg lg:border lg:border-[var(--border)] lg:bg-[var(--muted)] lg:p-3">
          <div className="mb-3 flex items-center gap-3 lg:mb-4 lg:px-2 lg:pt-1">
            <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--foreground)] text-sm font-semibold uppercase text-[var(--background)]">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--foreground)]">{displayName}</p>
              {showEmail ? <p className="break-all text-xs leading-snug text-[var(--muted-foreground)]">{customer.email}</p> : null}
            </div>
            <div className="lg:hidden">
              <LogoutButton />
            </div>
          </div>
          <AccountNav />
          <div className="mt-auto hidden border-t border-[var(--border)] pt-3 lg:block">
            <LogoutButton fullWidth />
          </div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
