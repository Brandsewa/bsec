import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { evaluateStorefrontAccess, getClientIp, lookupOrderForTracking, RateLimitExceededError, readTrackingConfig } from "@bs/domain";
import { server } from "@/server/runtime.ts";

export const metadata: Metadata = {
  title: "Track your order",
  description: "Enter your order number and the email or phone you ordered with.",
  robots: { index: false, follow: false },
};

async function resolveTenant() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });
  return { rt, h, tenantId: access.tenantId ?? null };
}

/** Looks the order up and sends the shopper to its tracking page. Every failure goes back to this form with the same message. */
async function lookup(formData: FormData) {
  "use server";
  const number = String(formData.get("order") ?? "").slice(0, 40);
  const contact = String(formData.get("contact") ?? "").slice(0, 120);
  const { rt, h, tenantId } = await resolveTenant();
  if (!tenantId) notFound();

  const config = await readTrackingConfig(rt._db.db, tenantId);
  if (!config.enabled) notFound();

  let target: string;
  try {
    const token = await lookupOrderForTracking(rt._db.db, tenantId, { number, contact, ip: getClientIp(h), method: config.lookup });
    target = token ? `/o/${token}` : `/track?error=notfound&order=${encodeURIComponent(number)}`;
  } catch (err) {
    if (!(err instanceof RateLimitExceededError)) throw err;
    target = "/track?error=wait";
  }
  redirect(target);
}

const MESSAGES: Record<string, string> = {
  notfound: "We couldn't find an order that matches those details. Check the order number and the email or phone you used, then try again.",
  wait: "Too many attempts. Please wait a few minutes and try again.",
};

export default async function TrackOrderPage({ searchParams }: { searchParams: Promise<{ error?: string; order?: string }> }) {
  const { rt, tenantId } = await resolveTenant();
  if (!tenantId) notFound();
  const config = await readTrackingConfig(rt._db.db, tenantId);
  if (!config.enabled) notFound();
  const contactLabel = config.lookup === "email" ? "Email" : config.lookup === "phone" ? "Phone number" : "Email or phone number";
  const sp = await searchParams;
  const error = sp.error ? MESSAGES[sp.error] : undefined;
  const prefill = (sp.order ?? "").slice(0, 40);

  return (
    <div className="bs-skin mx-auto max-w-lg px-4 py-16 sm:px-6">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-extrabold text-foreground">Track your order</h1>
        <p className="mt-2 text-sm text-muted-foreground">Enter your order number and the {contactLabel.toLowerCase()} you used when you ordered.</p>
        {config.message ? <p className="mt-3 rounded-lg bg-muted p-3 text-sm text-foreground">{config.message}</p> : null}

        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
            {error}
          </p>
        ) : null}

        <form action={lookup} className="mt-6 grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            Order number
            <input
              name="order"
              required
              maxLength={40}
              defaultValue={prefill}
              autoComplete="off"
              placeholder="e.g. #ORD-00012"
              className="h-11 rounded-lg border border-border bg-background px-3 text-base font-normal text-foreground"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            {contactLabel}
            <input
              name="contact"
              required
              maxLength={120}
              autoComplete={config.lookup === "phone" ? "tel" : "email"}
              placeholder={config.lookup === "email" ? "you@example.com" : config.lookup === "phone" ? "98765 43210" : "you@example.com or 98765 43210"}
              className="h-11 rounded-lg border border-border bg-background px-3 text-base font-normal text-foreground"
            />
          </label>
          <button type="submit" className="h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Track order
          </button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">Signed in? Your orders are also under My account.</p>
      </div>
    </div>
  );
}
