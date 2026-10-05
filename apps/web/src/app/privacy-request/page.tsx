import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluateStorefrontAccess } from "@bs/domain";
import { PrivacyRequestForm } from "@/components/account/PrivacyRequestForm.tsx";
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

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight sm:text-3xl">
            Customer Privacy & Data Rights
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            In accordance with applicable privacy laws including India's Digital Personal Data Protection Act, 2023, you have the right to request access, correction, or erasure of your personal data, or register a privacy inquiry.
          </p>
        </div>

        <PrivacyRequestForm />

        <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground">How we handle requests</p>
          <p>
            • To prevent unauthorized data disclosure or alteration, a confirmation link will be emailed to you before any action is taken.
          </p>
          <p>
            • Transactional order and invoice records are retained in compliance with applicable tax and commercial accounting regulations.
          </p>
        </div>

        <div className="border-t border-border pt-4">
          <Link href="/" className="text-sm font-medium text-primary hover:underline">
            ← Back to the store
          </Link>
        </div>
      </div>
    </div>
  );
}
