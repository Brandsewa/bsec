const KEY = "bs_active_store_id";

/**
 * The store the user has chosen to work in. This is only a selection: the server checks the signed-in
 * user's membership for it on every request, so a forged value can never reach another store's data.
 */
export function getActiveStoreId(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setActiveStoreId(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable: the first store is used */
  }
}

export function clearActiveStoreId(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
