import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluateStorefrontAccess } from "@bs/domain";
import { AuthShell } from "@bs/ui";
import { PrivacyRequestForm } from "@/components/account/PrivacyRequestForm.tsx";
import { getCachedStoreName } from "@/server/cached-storefront.ts";
import { server } from "@/server/runtime.ts";

export const metadata: Metadata = {
  title: "Data Privacy Request",
  description: "Exercise your data principal privacy rights",
  robots: { index: false, follow: false },
};

export default async function PrivacyRequestPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });
  if (!access.tenantId) notFound();

  const storeName = await getCachedStoreName(access.tenantId).catch(() => "Store");

  return (
    <AuthShell
      variant="store"
      brand={{ name: storeName }}
      title="Privacy & Data Rights"
      description="Request access, correction, or erasure of your personal data."
      footer={
        <Link href="/" className="text-xs text-[var(--brand-ink)] hover:underline">
          ← Back to the store
        </Link>
      }
    >
      <div className="space-y-4">
        <PrivacyRequestForm />
        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-[11px] text-[var(--muted-foreground)] space-y-1.5 leading-relaxed">
          <p className="font-semibold text-[var(--foreground)]">How we handle requests</p>
          <p>
            • To prevent unauthorized data disclosure, a confirmation link will be emailed to you before any action is taken.
          </p>
          <p>
            • Transactional records are retained in compliance with applicable tax regulations.
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
