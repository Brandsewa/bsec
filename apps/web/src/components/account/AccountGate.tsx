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

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-5 sm:px-6 sm:py-10">
      <div className="mb-4 flex items-center justify-between gap-3 sm:mb-6">
        <div className="min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">My account</span>
          <h1 className="truncate text-2xl font-bold tracking-tight text-[var(--foreground)]">{customer.name || customer.phone}</h1>
        </div>
        <LogoutButton />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start lg:rounded-2xl lg:bg-[var(--muted)] lg:p-3">
          <AccountNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
