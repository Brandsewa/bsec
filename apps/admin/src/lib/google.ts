import { apiBase } from "./config.ts";

/** Secret-free Google sign-in settings from the platform (GET /api/public/google-signin). */
export interface GoogleSignin {
  enabled: boolean;
  clientId: string | null;
  oneTap: boolean;
  signupAllowed: boolean;
}

const OFF: GoogleSignin = { enabled: false, clientId: null, oneTap: false, signupAllowed: false };

export async function fetchGoogleSignin(): Promise<GoogleSignin> {
  try {
    const res = await fetch(`${apiBase()}/api/public/google-signin`, { credentials: "include" });
    if (!res.ok) return OFF;
    return (await res.json()) as GoogleSignin;
  } catch {
    return OFF;
  }
}

/** Starts Google sign-in for an existing account; the browser goes to Google and returns signed in. */
export async function startGoogleSignIn(): Promise<{ ok: false; message: string }> {
  try {
    const res = await fetch(`${apiBase()}/api/auth/sign-in/social`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "google",
        callbackURL: `${window.location.origin}/`,
        errorCallbackURL: `${window.location.origin}/login?google_error=1`,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
    if (res.ok && data.url) {
      window.location.assign(data.url);
      return { ok: false, message: "" };
    }
    return { ok: false, message: data.message || "Google sign-in is not available right now." };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (cfg: Record<string, unknown>) => void;
      prompt: () => void;
      cancel: () => void;
    };
  };
}

let gsiLoading: Promise<GoogleIdentity | null> | null = null;

function loadGsi(): Promise<GoogleIdentity | null> {
  const w = window as unknown as { google?: GoogleIdentity };
  if (w.google?.accounts) return Promise.resolve(w.google);
  gsiLoading ??= new Promise((resolve) => {
    const el = document.createElement("script");
    el.src = "https://accounts.google.com/gsi/client";
    el.async = true;
    el.onload = () => resolve((window as unknown as { google?: GoogleIdentity }).google ?? null);
    el.onerror = () => resolve(null);
    document.head.appendChild(el);
  });
  return gsiLoading;
}

/**
 * Shows Google One Tap on the sign-in page. The ID token goes to Better Auth's one-tap endpoint, which signs in an
 * existing account only. Returns a cleanup function.
 */
export async function startOneTap(clientId: string, onSignedIn: () => void): Promise<() => void> {
  const google = await loadGsi();
  if (!google) return () => undefined;
  google.accounts.id.initialize({
    client_id: clientId,
    use_fedcm_for_prompt: true,
    cancel_on_tap_outside: false,
    callback: async (response: { credential?: string }) => {
      if (!response.credential) return;
      try {
        const res = await fetch(`${apiBase()}/api/auth/one-tap/callback`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken: response.credential }),
        });
        if (res.ok) onSignedIn();
      } catch {
        /* the normal sign-in form stays available */
      }
    },
  });
  google.accounts.id.prompt();
  return () => google.accounts.id.cancel();
}
