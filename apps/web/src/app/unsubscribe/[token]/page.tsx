import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluateStorefrontAccess, getUnsubscribeView } from "@bs/domain";
import { AuthShell } from "@bs/ui";
import { UnsubscribeButton } from "@/components/account/UnsubscribeButton.tsx";
import { server } from "@/server/runtime.ts";

export const metadata: Metadata = {
  title: "Unsubscribe",
  description: "Stop receiving marketing emails",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });
  if (!access.tenantId) notFound();

  // Reading the link changes nothing; only the button (a POST) unsubscribes.
  const view = await getUnsubscribeView(rt._db.db, access.tenantId, token);

  return (
    <AuthShell
      title="Unsubscribe"
      subtitle={
        view.state === "invalid"
          ? "This unsubscribe link is not valid or has expired."
          : view.state === "subscribed"
            ? `Stop marketing emails to ${view.maskedEmail}?`
            : `${view.maskedEmail} is not on our marketing list.`
      }
      variant="centered"
    >
      <div className="space-y-4">
        {view.state === "invalid" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground" data-testid="unsubscribe-invalid">
              If you still get emails you do not want, use the link in the latest email, or sign in to your account and turn off marketing there.
            </p>
            <div>
              <Link href="/account/profile" className="text-sm font-medium text-primary hover:underline">
                Go to my account
              </Link>
            </div>
          </div>
        ) : (
          <UnsubscribeButton token={token} alreadyDone={view.state === "unsubscribed"} />
        )}

        <div className="border-t border-border pt-4">
          <Link href="/" className="text-sm font-medium text-primary hover:underline">
            ← Back to the store
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

