"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@bs/ui";

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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={logout}
      disabled={busy}
      loading={busy}
    >
      Sign out
    </Button>
  );
}
