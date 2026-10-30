"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "@bs/ui";

/** Withdraws a return that the store has not looked at yet. */
export function CancelReturnButton({ returnId }: { returnId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/storefront/customer/returns/${returnId}/cancel`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not cancel the return");
      setConfirm(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the return");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button type="button" variant="ghost" size="sm" className="text-[var(--destructive)]" onClick={() => setConfirm(true)} disabled={busy}>
        Cancel request
      </Button>
      {error ? <p role="alert" className="mt-1 text-xs text-[var(--destructive)]">{error}</p> : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Cancel this return request?"
        description="The store has not started on it yet. You can send a new request any time."
        confirmLabel="Cancel request"
        destructive
        pending={busy}
        onConfirm={cancel}
      />
    </div>
  );
}
