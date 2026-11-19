/**
 * Ruttl bug-tracking widget, loaded only for the stores listed in RUTTL_STORE_HOSTS (a QA/review store), never for other
 * merchants. The admin is one app for every store, so the check runs after sign-in against the active store's address.
 */
const RUTTL_PROJECT_ID = "0fRYAZqvnd7L29QYWUhA";
const RUTTL_STORE_HOSTS = ["brandsewa.bcom.si"];

export function loadRuttlForStore(storefrontUrl: string | undefined): void {
  if (!storefrontUrl || document.querySelector("ruttl-widget")) return;
  let host: string;
  try {
    host = new URL(storefrontUrl).hostname.toLowerCase();
  } catch {
    return;
  }
  if (!RUTTL_STORE_HOSTS.includes(host)) return;
  const widget = document.createElement("ruttl-widget");
  widget.setAttribute("project-id", RUTTL_PROJECT_ID);
  document.body.appendChild(widget);
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/gh/ruttl/scripts@main/ruttl.min.js";
  script.async = true;
  document.body.appendChild(script);
}
