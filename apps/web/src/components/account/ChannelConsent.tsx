"use client";

import React, { useState } from "react";
import { Alert, AlertDescription, Checkbox } from "@bs/ui";

/** Texting and WhatsApp offers. Each switch saves on its own; order updates are not marketing and are unaffected. */
export function ChannelConsent(props: { sms: boolean; whatsapp: boolean; updatedAt: string | null }) {
  const [sms, setSms] = useState(props.sms);
  const [whatsapp, setWhatsapp] = useState(props.whatsapp);
  const [updatedAt, setUpdatedAt] = useState(props.updatedAt);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: { sms: boolean; whatsapp: boolean }, rollback: () => void) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/storefront/customer/channel-consent", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; consent?: { updatedAt: string | null } };
      if (!res.ok) throw new Error(data.error ?? "Could not save your choice");
      setUpdatedAt(data.consent?.updatedAt ?? null);
    } catch (err) {
      rollback();
      setError(err instanceof Error ? err.message : "Could not save your choice");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="channel-consent">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center gap-2.5">
        <Checkbox
          id="consent-sms"
          checked={sms}
          disabled={busy}
          onCheckedChange={(c) => {
            const v = c === true;
            setSms(v);
            void save({ sms: v, whatsapp }, () => setSms(!v));
          }}
        />
        <label htmlFor="consent-sms" className="cursor-pointer select-none text-xs text-[var(--muted-foreground)]">
          Send me offers by text message
        </label>
      </div>
      <div className="flex items-center gap-2.5">
        <Checkbox
          id="consent-whatsapp"
          checked={whatsapp}
          disabled={busy}
          onCheckedChange={(c) => {
            const v = c === true;
            setWhatsapp(v);
            void save({ sms, whatsapp: v }, () => setWhatsapp(!v));
          }}
        />
        <label htmlFor="consent-whatsapp" className="cursor-pointer select-none text-xs text-[var(--muted-foreground)]">
          Send me offers on WhatsApp
        </label>
      </div>
      {updatedAt ? <p className="text-[11px] text-[var(--muted-foreground)]">Last changed {new Date(updatedAt).toLocaleDateString()}</p> : null}
    </div>
  );
}
