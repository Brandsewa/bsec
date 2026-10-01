const TOKEN_KEY = "bs_support_token";
const STORE_KEY = "bs_support_store";

/**
 * A platform support session is carried in sessionStorage only (gone when the tab closes), never in localStorage or a
 * cookie. The server checks the token on every request; this is just where the browser keeps it.
 */
export function getSupportToken(): string | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getSupportStoreId(): string | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

export function setSupportSession(token: string, storeId: string): void {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
    window.sessionStorage.setItem(STORE_KEY, storeId);
  } catch {
    /* storage unavailable: the support link will not work in this browser */
  }
}

export function clearSupportSession(): void {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

/** Reads `#token=...&store=...` (the URL fragment never reaches a server or its logs). */
export function readSupportHandoff(hash: string): { token: string; storeId: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("token");
  const storeId = params.get("store");
  if (!token || !storeId || !/^sup_[0-9a-f]{64}$/.test(token)) return null;
  return { token, storeId };
}
