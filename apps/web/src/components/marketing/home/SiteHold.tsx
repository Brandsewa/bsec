import type { ReactNode } from "react";
import { siteStatus } from "@/server/site-settings.ts";

/** The holding block for the public pages when Settings > Website visibility is not Live. Null when the site is live. */
export async function siteHold(): Promise<ReactNode | null> {
  const s = await siteStatus();
  if (s.mode === "live") return null;
  const maintenance = s.mode === "maintenance";
  return (
    <section className="hero">
      <div className="wrap hero-in solo">
        <div>
          <span className="stamp"><b />{maintenance ? "Maintenance" : "Coming soon"}</span>
          <h1>{s.headline || (maintenance ? "We are doing some maintenance." : "We are getting ready.")}</h1>
          <p className="lead">{maintenance ? "The website will be back shortly. Please check again soon." : "Please check back soon."}</p>
        </div>
      </div>
    </section>
  );
}
