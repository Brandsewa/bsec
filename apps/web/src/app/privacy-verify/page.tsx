import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluateStorefrontAccess, verifyPrivacyRequest } from "@bs/domain";
import { AuthShell, Button, Alert, AlertDescription } from "@bs/ui";
import { getCachedStoreName } from "@/server/cached-storefront.ts";
import { server } from "@/server/runtime.ts";

export const metadata: Metadata = {
  title: "Verify Privacy Request",
  description: "Verification of customer privacy request",
  robots: { index: false, follow: false },
};

export default async function PrivacyVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });
  if (!access.tenantId) notFound();

  const storeName = await getCachedStoreName(access.tenantId).catch(() => "Store");

  let result: { success: boolean; message: string } = {
    success: false,
    message: "Missing verification token.",
  };

  if (token) {
    result = await verifyPrivacyRequest(rt._db.db, access.tenantId, token);
  }

  return (
    <AuthShell
      variant="store"
      brand={{ name: storeName }}
      title={result.success ? "Request Confirmed" : "Verification Failed"}
      description="Customer Privacy Request"
      footer={
        <Link href="/" className="text-xs text-[var(--brand-ink)] hover:underline">
          ← Back to the store
        </Link>
      }
    >
      {result.success ? (
        <div className="space-y-4">
          <Alert variant="default" className="border-[var(--brand)] bg-[var(--brand-soft)]">
            <AlertDescription className="text-xs text-[var(--foreground)]">
              {result.message}
            </AlertDescription>
          </Alert>
          <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
            Our privacy team will process your request within the statutory timeframe. If you requested a data export, an encrypted download link will be delivered to your email upon completion.
          </p>
          <Button asChild size="md" className="w-full">
            <Link href="/">Return to Store</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Alert variant="destructive" role="alert">
            <AlertDescription className="text-xs">{result.message}</AlertDescription>
          </Alert>
          <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
            This link may have already been used, expired after 24 hours, or been entered incorrectly.
          </p>
          <Button asChild variant="secondary" size="md" className="w-full">
            <Link href="/privacy-request">Submit a new request</Link>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
