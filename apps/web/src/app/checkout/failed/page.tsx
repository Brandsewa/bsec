import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { evaluateStorefrontAccess, getStoreSettings } from "@bs/domain";
import { DEFAULT_PAGES } from "@bs/blocks";
import { Button } from "@bs/ui";
import { server } from "@/server/runtime.ts";
import { getCachedDefaultPages } from "@/server/cached-storefront.ts";

export const metadata: Metadata = {
  title: "Payment unsuccessful",
  description: "Your payment did not go through.",
  robots: { index: false, follow: false },
};

// Copy comes from the theme, chosen by reason code: the query string itself is never echoed, so a crafted link cannot show shoppers arbitrary text.

interface FailedPageProps {
  searchParams: Promise<{ reason?: string }>;
}

/** Payment failed. The cart is left untouched so the shopper can retry, pick another method (such as cash on delivery) or get help. */
export default async function CheckoutFailedPage({ searchParams }: FailedPageProps) {
  const { reason } = await searchParams;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });
  let supportEmail: string | null = null;
  const copy = (access.tenantId ? await getCachedDefaultPages(access.tenantId) : null)?.paymentFailed ?? DEFAULT_PAGES.paymentFailed;
  const message = reason === "declined" ? copy.declinedMessage : reason === "cancelled" ? copy.cancelledMessage : copy.errorMessage;
  if (access.tenantId && copy.showSupportEmail) {
    const settings = await getStoreSettings(rt, {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" },
      roles: ["store_admin"],
      permissions: ["settings.write"],
      requestId: crypto.randomUUID(),
    }).catch(() => null);
    supportEmail = settings?.supportEmail ?? null;
  }

  return (
    <div className="bs-skin mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
        <svg aria-hidden className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{copy.heading}</h1>
      <p role="alert" className="mt-3 text-base text-muted-foreground">
        {message}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">Your cart is saved. You can try again or choose a different payment method.</p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href="/checkout">Try again</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/cart">Back to cart</Link>
        </Button>
      </div>
      {supportEmail ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Need help? Write to <a className="font-medium underline" href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      ) : null}
    </div>
  );
}
