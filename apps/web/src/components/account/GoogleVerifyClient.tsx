"use client";

import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loadGoogleScript } from "@/lib/google-identity.ts";

type State = "loading" | "ready" | "done" | "error";

/** The store owner's setup test. No customer account or session is created: it only marks the setup as verified. */
export function GoogleVerifyClient() {
  const params = useSearchParams();
  const ticket = params.get("t");
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<State>(ticket ? "loading" : "error");
  const [message, setMessage] = useState<string | null>(ticket ? null : "This test link is missing. Start the test again from Store Admin.");

  useEffect(() => {
    if (!ticket) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/storefront/customer/google/verify-setup?t=${encodeURIComponent(ticket)}`, { cache: "no-store" });
        const cfg = (await res.json()) as { clientId?: string; nonce?: string; error?: string };
        if (!res.ok || !cfg.clientId || !cfg.nonce) throw new Error(cfg.error ?? "This test link is not valid.");
        const nonce = cfg.nonce;
        await loadGoogleScript();
        if (cancelled || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: cfg.clientId,
          nonce,
          use_fedcm_for_prompt: true,
          callback: async (resp: { credential?: string }) => {
            if (!resp.credential) return;
            const r = await fetch("/api/storefront/customer/google/verify-setup", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ticket, idToken: resp.credential, nonce }),
            });
            const data = (await r.json().catch(() => ({}))) as { error?: string };
            if (!r.ok) {
              setState("error");
              setMessage(data.error ?? "The test did not pass.");
              return;
            }
            setState("done");
          },
        });
        if (buttonRef.current) {
          window.google.accounts.id.renderButton(buttonRef.current, { theme: "outline", size: "large", text: "signin_with", width: 320 });
        }
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        setState("error");
        setMessage(
          err instanceof Error && err.message !== "google script"
            ? err.message
            : "Google's sign-in could not load. Check that this domain is listed as an Authorized JavaScript origin on your Google app.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticket]);

  return (
    <div className="w-full space-y-4 text-sm" data-testid="google-verify">
      {state === "loading" ? <p className="text-[var(--muted-foreground)]">Getting ready…</p> : null}
      {state === "ready" ? (
        <>
          <p className="text-[var(--muted-foreground)]">Sign in with any Google account. Nothing is saved to your customers.</p>
          <div ref={buttonRef} className="flex justify-center" />
        </>
      ) : null}
      {state === "done" ? (
        <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
          Google sign-in works on this domain. Go back to Store Admin and turn it on.
        </p>
      ) : null}
      {state === "error" ? (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-[var(--destructive)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
