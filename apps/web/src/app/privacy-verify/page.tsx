import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluateStorefrontAccess, verifyPrivacyRequest } from "@bs/domain";
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

  let result: { success: boolean; message: string } = {
    success: false,
    message: "Missing verification token.",
  };

  if (token) {
    result = await verifyPrivacyRequest(rt._db.db, access.tenantId, token);
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8 space-y-5">
        <h1 className="text-2xl font-extrabold text-foreground">Request Verification</h1>

        {result.success ? (
          <div className="space-y-4">
            <div className="flex items-center space-x-3 text-green-600 dark:text-green-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <h2 className="text-lg font-semibold text-foreground">Request Confirmed</h2>
            </div>
            <p className="text-sm text-muted-foreground">{result.message}</p>
            <p className="text-xs text-muted-foreground">
              Our privacy team will process your request within the statutory timeframe. If you requested a data export, an encrypted download link will be delivered to your email upon completion.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center space-x-3 text-destructive">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <h2 className="text-lg font-semibold text-foreground">Verification Failed</h2>
            </div>
            <p className="text-sm text-muted-foreground">{result.message}</p>
            <p className="text-xs text-muted-foreground">
              This link may have already been used, expired after 24 hours, or been entered incorrectly.
            </p>
            <Link href="/privacy-request" className="inline-block text-sm font-medium text-primary hover:underline">
              Submit a new request
            </Link>
          </div>
        )}

        <div className="border-t border-border pt-4">
          <Link href="/" className="text-sm font-medium text-primary hover:underline">
            ← Back to the store
          </Link>
        </div>
      </div>
    </div>
  );
}
