"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface Item {
  id: string;
  title: string;
  variant: string | null;
  returnable: number;
}

/** "Request a return" on the order page: pick items and quantities, say why, send. */
export function ReturnRequestForm({ token, items }: { token: string; items: Item[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = items.filter((i) => i.returnable > 0);
  if (available.length === 0) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const chosen = available.map((i) => ({ orderItemId: i.id, quantity: qty[i.id] ?? 0 })).filter((i) => i.quantity > 0);
    if (chosen.length === 0) return setError("Choose at least one item to return");
    setBusy(true);
    try {
      const res = await fetch(`/api/storefront/orders/${encodeURIComponent(token)}/return`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, items: chosen }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not send your return request");
      setOpen(false);
      setQty({});
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your return request");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted">
        Request a return
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border p-4" data-testid="return-form">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Request a return</h3>
      {available.map((i) => (
        <label key={i.id} className="flex items-center justify-between gap-3 text-sm">
          <span>
            {i.title}
            {i.variant ? <span className="text-muted-foreground"> ({i.variant})</span> : null}
          </span>
          <select
            aria-label={`Quantity of ${i.title} to return`}
            value={qty[i.id] ?? 0}
            onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })}
            className="rounded-md border border-border bg-background px-2 py-1"
          >
            {Array.from({ length: i.returnable + 1 }, (_, n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ))}
      <textarea
        required
        minLength={3}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="What went wrong? (damaged, wrong item, changed my mind…)"
        className="w-full rounded-md border border-border bg-background p-2 text-sm"
        rows={3}
      />
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? "Sending…" : "Send request"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-muted-foreground">
          Cancel
        </button>
      </div>
    </form>
  );
}
