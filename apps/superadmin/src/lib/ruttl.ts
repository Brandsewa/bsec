/** Ruttl bug-tracking widget, loaded only on the production Super Admin host (never on a local or other deployment). */
const RUTTL_PROJECT_ID = "0fRYAZqvnd7L29QYWUhA";
const RUTTL_HOSTS = ["superadmin.bcom.si"];

export function loadRuttl(): void {
  if (!RUTTL_HOSTS.includes(window.location.hostname.toLowerCase()) || document.querySelector("ruttl-widget")) return;
  const widget = document.createElement("ruttl-widget");
  widget.setAttribute("project-id", RUTTL_PROJECT_ID);
  document.body.appendChild(widget);
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/gh/ruttl/scripts@main/ruttl.min.js";
  script.async = true;
  document.body.appendChild(script);
}
