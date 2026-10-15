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
    <div className="mx-auto w-full max-w-[1000px] px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 pb-2">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">My account</span>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">{customer.name || customer.phone}</h1>
        </div>
        <div className="flex items-center gap-3">
          
          <LogoutButton />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <AccountNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
