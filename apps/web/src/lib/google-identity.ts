/**
 * Google Identity Services loader and types, shared by the storefront customer sign-in and the owner signup page.
 * The script is loaded only when Google sign-in is switched on and only on the pages that need it.
 */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: Record<string, unknown>) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
          prompt: () => void;
          cancel: () => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

export function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts) return resolve();
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    const el = existing ?? document.createElement("script");
    el.addEventListener("load", () => resolve(), { once: true });
    el.addEventListener("error", () => reject(new Error("google script")), { once: true });
    if (!existing) {
      el.src = "https://accounts.google.com/gsi/client";
      el.async = true;
      document.head.appendChild(el);
    }
  });
}

/** Runs `fn` once the page has loaded and the browser is idle, so Google's ~100 KB script never competes with first paint. */
export function whenIdle(fn: () => void, timeoutMs = 4000): () => void {
  let cancelled = false;
  let handle: number | undefined;
  const run = () => {
    if (cancelled) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    handle = w.requestIdleCallback ? w.requestIdleCallback(() => !cancelled && fn(), { timeout: timeoutMs }) : window.setTimeout(() => !cancelled && fn(), 1500);
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", run);
    void handle;
  };
}

type CredentialHandler = (credential: string, nonce: string) => void;
let initializedKey: string | null = null;
let initializedNonce = "";
let activeHandler: CredentialHandler | null = null;

/**
 * Google keeps only the LAST initialize() call, and the home page can mount more than one sign-in component. So it is
 * called once per client id; later components only swap in their own handler. The nonce Google was initialised with is
 * the one a sign-in is bound to, so it is the one handed back to the handler.
 */
export function initGoogleOnce(clientId: string, nonce: string, handler: CredentialHandler, extra: Record<string, unknown>): () => void {
  activeHandler = handler;
  if (initializedKey !== clientId) {
    initializedKey = clientId;
    initializedNonce = nonce;
    window.google?.accounts.id.initialize({
      client_id: clientId,
      nonce,
      ...extra,
      callback: (resp: { credential?: string }) => {
        if (resp.credential) activeHandler?.(resp.credential, initializedNonce);
      },
    });
  }
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}
