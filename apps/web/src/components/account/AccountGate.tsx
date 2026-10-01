import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LoginForm } from "@/components/account/LoginForm.tsx";
import { LogoutButton } from "@/components/account/LogoutButton.tsx";
import { currentCustomer, resolveStore } from "@/server/customer-session.ts";

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

  if (!customer) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <LoginForm />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">My account</span>
          <h1 className="text-2xl font-extrabold text-foreground">{customer.name || customer.phone}</h1>
        </div>
        <LogoutButton />
      </div>
      <nav aria-label="Account" className="mb-6 flex gap-4 text-sm font-medium">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground">
            {l.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
