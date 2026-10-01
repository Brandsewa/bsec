"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/storefront/customer/logout", { method: "POST" });
    } finally {
      router.push("/account");
      router.refresh();
    }
  }

  return (
    <button type="button" onClick={logout} disabled={busy} className="text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-60">
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
