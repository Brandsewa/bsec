"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import { AuthShell, Button, Alert, AlertDescription, Spinner } from "@bs/ui";

export default function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;

  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

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

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  return (
    <div data-testid="verify-email-page">
      <AuthShell
        variant="store"
        brand={{ name: "Store" }}
        title="Email verification"
        description="Verifying your account email address"
      >
        {status === "verifying" ? (
          <div className="flex flex-col items-center justify-center py-6 space-y-3 text-center">
            <Spinner size="md" />
            <p className="text-xs text-[var(--muted-foreground)]">Verifying your email address, please wait…</p>
          </div>
        ) : status === "success" ? (
          <div className="space-y-4">
            <Alert variant="default" className="border-[var(--brand)] bg-[var(--brand-soft)]">
              <AlertDescription className="text-xs text-[var(--foreground)]">
                Your email has been verified! You now have full access to your account and historical orders.
              </AlertDescription>
            </Alert>
            <Button asChild size="md" className="w-full">
              <Link href="/account">Go to my account</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert variant="destructive" role="alert">
              <AlertDescription className="text-xs">
                {errorMessage ?? "Verification link is invalid or has expired."}
              </AlertDescription>
            </Alert>
            <Button asChild size="md" className="w-full">
              <Link href="/account">Go to account</Link>
            </Button>
            {resendCooldown > 0 ? (
              <p className="text-center text-xs text-[var(--muted-foreground)]">
                Resend available in {resendCooldown}s
              </p>
            ) : null}
          </div>
        )}
      </AuthShell>
    </div>
  );
}
