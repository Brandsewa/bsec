"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@bs/ui";
import "@/lib/google-identity.ts";

export function LogoutButton() {
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
      className="shrink-0 bg-[var(--muted)] text-[var(--foreground)] hover:bg-[var(--muted)]/70"
      onClick={logout}
      disabled={busy}
      loading={busy}
    >
      Sign out
    </Button>
  );
}
