"use client";

import React, { useState } from "react";
import { Button, Alert, AlertDescription } from "@bs/ui";

/** One-click confirmation for the unsubscribe page: nothing changes until the shopper presses the button. */
export function UnsubscribeButton({ token, alreadyDone }: { token: string; alreadyDone: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done">(alreadyDone ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setState("busy");
    try {
      const res = await fetch(`/api/storefront/unsubscribe/${encodeURIComponent(token)}`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not unsubscribe you right now");
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unsubscribe you right now");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <Alert variant="default" className="border-[var(--brand)] bg-[var(--brand-soft)]" role="status" data-testid="unsubscribed">
        <AlertDescription className="text-xs text-[var(--foreground)]">
          You are unsubscribed. You will not get marketing emails from us any more. Order updates will still reach you.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="button"
        size="md"
        onClick={confirm}
        disabled={state === "busy"}
        loading={state === "busy"}
      >
        {state === "busy" ? "Unsubscribing…" : "Unsubscribe"}
      </Button>
    </div>
  );
}
