"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription, Button, ConfirmDialog } from "@bs/ui";
import { LocalTime } from "./LocalTime.tsx";

export interface SessionRow {
  id: string;
  device: string;
  ip: string | null;
  signedInAt: string;
  current: boolean;
}

/** Where the shopper is signed in, with a way to end the ones they do not recognise. */
export function CustomerSessions({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const others = sessions.filter((s) => !s.current).length;

  async function send(body: { action: "revoke"; id: string } | { action: "revokeOthers" }, key: string) {
    setError(null);
    setBusyId(key);
    try {
      const res = await fetch("/api/storefront/customer/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not sign that device out");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign that device out");
    } finally {
      setBusyId(null);
      setConfirmAll(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="customer-sessions">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}
      <ul className="divide-y divide-[var(--border)]">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 text-sm">
              <p className="font-medium">
                {s.device}
                {s.current ? <span className="ml-2 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-semibold">This device</span> : null}
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {s.ip ?? "Unknown address"} · signed in <LocalTime iso={s.signedInAt} />
              </p>
            </div>
            {s.current ? null : (
              <Button type="button" size="sm" variant="outline" disabled={busyId !== null} loading={busyId === s.id} onClick={() => void send({ action: "revoke", id: s.id }, s.id)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      {others > 0 ? (
        <Button type="button" size="sm" variant="outline" disabled={busyId !== null} onClick={() => setConfirmAll(true)}>
          Sign out all other devices
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out all other devices?"
        description="You stay signed in here. Every other device will need to sign in again."
        confirmLabel="Sign them out"
        destructive
        pending={busyId === "all"}
        onConfirm={() => void send({ action: "revokeOthers" }, "all")}
      />
    </div>
  );
}
