"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadGoogleScript } from "@/lib/google-identity.ts";

/**
 * "Continue with Google" and One Tap for the store's customers. Rendered only on the sign-in page, and only when the
 * store switched Google sign-in on and this host is one of its verified custom domains; otherwise it renders nothing
 * and Google's script is never loaded.
 */
export function GoogleSignIn({
  redirectTo,
  oneTap = true,
  button = true,
  text = "continue_with",
}: {
  redirectTo: string;
  /** Show the floating One Tap prompt. */
  oneTap?: boolean;
  /** Draw the Continue with Google button. Off for the prompt-only use on the home and content pages. */
  button?: boolean;
  text?: "continue_with" | "signup_with" | "signin_with";
}) {
  const router = useRouter();
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = (await fetch("/api/storefront/customer/google", { cache: "no-store" }).then((r) => r.json())) as {
          enabled?: boolean;
          clientId?: string;
          nonce?: string;
          oneTap?: boolean;
        };
        if (cancelled || !cfg.enabled || !cfg.clientId || !cfg.nonce) return;
        const nonce = cfg.nonce;
        await loadGoogleScript();
        if (cancelled || !window.google) return;
        setActive(true);
        window.google.accounts.id.initialize({
          client_id: cfg.clientId,
          nonce,
          use_fedcm_for_prompt: true,
          cancel_on_tap_outside: false,
          callback: async (resp: { credential?: string }) => {
            if (!resp.credential) return;
            setError(null);
            const res = await fetch("/api/storefront/customer/google", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ idToken: resp.credential, nonce }),
            });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) {
              setError(data.error ?? "Google sign-in did not work. Please try again.");
              return;
            }
            router.replace(redirectTo);
            router.refresh();
          },
        });
        if (button && buttonRef.current) {
          window.google.accounts.id.renderButton(buttonRef.current, { theme: "outline", size: "large", text, width: 320 });
        }
        if (oneTap && cfg.oneTap) window.google.accounts.id.prompt();
      } catch {
        /* Email and phone sign-in always remain available. */
      }
    })();
    return () => {
      cancelled = true;
      window.google?.accounts.id.cancel();
    };
  }, [redirectTo, router, oneTap, button, text]);

  if (!button) return null;

  // The container stays mounted (hidden until Google is on) so Google can draw its button into it as soon as it loads.
  return (
    <div className={active ? "space-y-3" : "hidden"} data-testid="google-signin">
      <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
        <span className="h-px flex-1 bg-[var(--border)]" />
        or
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
      <div ref={buttonRef} className="flex justify-center" />
      {error ? (
        <p role="alert" className="text-center text-xs text-[var(--destructive)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
