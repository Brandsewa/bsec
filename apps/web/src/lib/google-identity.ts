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
