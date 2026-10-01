"use client";

import React, { useState } from "react";

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
      <p role="status" className="rounded-lg bg-primary/10 px-4 py-3 text-sm font-medium text-primary" data-testid="unsubscribed">
        You are unsubscribed. You will not get marketing emails from us any more. Order updates will still reach you.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={confirm}
        disabled={state === "busy"}
        className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {state === "busy" ? "Unsubscribing…" : "Unsubscribe"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
