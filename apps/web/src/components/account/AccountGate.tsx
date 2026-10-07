import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthShell, ThemeToggle } from "@bs/ui";
import { LoginForm } from "@/components/account/LoginForm.tsx";
import { LogoutButton } from "@/components/account/LogoutButton.tsx";
import { currentCustomer, resolveStore } from "@/server/customer-session.ts";
import { getCachedStoreName } from "@/server/cached-storefront.ts";

const links = [
  { href: "/account", label: "Orders" },
  { href: "/account/addresses", label: "Addresses" },
  { href: "/account/profile", label: "Profile" },
];

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
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">My account</span>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">{customer.name || customer.phone}</h1>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <LogoutButton />
        </div>
      </div>
      <nav aria-label="Account" className="mb-8 flex gap-6 border-b border-[var(--border)] pb-2 text-sm font-medium">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors hover:border-b-2 hover:border-[var(--brand)]"
          >
            {l.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
