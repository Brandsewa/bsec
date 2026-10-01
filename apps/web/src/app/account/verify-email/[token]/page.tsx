"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";

export default function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;

  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function verify() {
      try {
        const res = await fetch("/api/storefront/customer/verify-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error ?? "Invalid or expired verification link");
        }

        if (active) {
          setStatus("success");
        }
      } catch (err) {
        if (active) {
          setStatus("error");
          setErrorMessage(err instanceof Error ? err.message : "Verification failed");
        }
      }
    }

    verify();

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8" data-testid="verify-email-page">
      <h1 className="text-2xl font-extrabold text-foreground">Email verification</h1>

      {status === "verifying" ? (
        <p className="mt-3 text-sm text-muted-foreground">Verifying your email address, please wait…</p>
      ) : status === "success" ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg bg-primary/10 p-4 text-center text-sm font-medium text-primary">
            Your email has been verified! You now have full access to your account and historical orders.
          </div>
          <Link
            href="/account"
            className="block w-full rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground"
          >
            Go to my account
          </Link>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg bg-red-50 p-4 text-center text-sm font-medium text-red-600 dark:bg-red-950/50 dark:text-red-400">
            {errorMessage ?? "Verification link is invalid or has expired."}
          </div>
          <Link
            href="/account"
            className="block text-center text-sm font-semibold text-primary hover:underline"
          >
            Go to account
          </Link>
        </div>
      )}
    </div>
  );
}
