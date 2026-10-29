"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@bs/ui";
import "@/lib/google-identity.ts";
import { ACCOUNT_ICONS } from "./account-icons.ts";

export function LogoutButton({ fullWidth = false }: { fullWidth?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/storefront/customer/logout", { method: "POST" });
      // Stops One Tap from silently signing the shopper straight back in.
      window.google?.accounts.id.disableAutoSelect();
    } finally {
      router.push("/account");
      router.refresh();
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={fullWidth ? "w-full justify-start gap-2 text-[var(--muted-foreground)] hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]" : "shrink-0 bg-[var(--muted)] text-[var(--foreground)] hover:bg-[var(--muted)]/70"}
      onClick={logout}
      disabled={busy}
      loading={busy}
    >
      {fullWidth ? (
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={ACCOUNT_ICONS.logout} />
        </svg>
      ) : null}
      Sign out
    </Button>
  );
}
