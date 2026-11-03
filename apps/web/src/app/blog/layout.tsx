import type { ReactNode } from "react";
import { headers } from "next/headers";
import { HomeFooter } from "@/components/marketing/home/HomeFooter.tsx";
import { HomeNav } from "@/components/marketing/home/HomeNav.tsx";
import { HomeRoot } from "@/components/marketing/home/HomeRoot.tsx";
import { siteHold } from "@/components/marketing/home/SiteHold.tsx";
import { isPlatformMarketingHost } from "@/server/hosts.ts";

/** On bcom.si the blog sits inside the marketing header and footer. On a store host the root layout's store chrome applies. */
export default async function BlogLayout({ children }: { children: ReactNode }) {
  const h = await headers();
  if (!isPlatformMarketingHost(h.get("x-forwarded-host") ?? h.get("host"))) return children;
  const hold = await siteHold();
  if (hold) return <HomeRoot><main id="main" className="mk-blog">{hold}</main></HomeRoot>;
  return (
    <HomeRoot>
      <HomeNav />
      <main id="main" className="mk-blog">{children}</main>
      <HomeFooter />
    </HomeRoot>
  );
}
