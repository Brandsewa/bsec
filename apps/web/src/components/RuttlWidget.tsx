import { createElement } from "react";
import Script from "next/script";

const RUTTL_PROJECT_ID = "0fRYAZqvnd7L29QYWUhA";
/** Ruttl bug tracking runs only on the platform site and the one review store, never on other tenants. */
const RUTTL_HOSTS = ["bcom.si", "www.bcom.si", "brandsewa.bcom.si"];

export function RuttlWidget({ host }: { host: string }) {
  if (!RUTTL_HOSTS.includes((host.split(":")[0] ?? "").toLowerCase())) return null;
  return (
    <>
      {createElement("ruttl-widget", { "project-id": RUTTL_PROJECT_ID })}
      <Script src="https://cdn.jsdelivr.net/gh/ruttl/scripts@main/ruttl.min.js" strategy="lazyOnload" />
    </>
  );
}
