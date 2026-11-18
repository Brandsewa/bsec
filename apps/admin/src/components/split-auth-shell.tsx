import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlatformLogo, usePlatformBrand } from "@bs/ui";
import { DEFAULT_LOGIN_PANEL, fetchLoginPanel } from "../lib/login-panel.ts";

/**
 * Sign-in screen split in two (logo above the form; the page supplies the small "Sign in" row): a content panel on the left (40%, text, colours and picture edited in the Super Admin) and the
 * form on the right (60%). The panel is hidden on phones and tablets, where only the form shows.
 */
export function SplitAuthShell({ title, description, raiseLogo = true, children }: { title?: string; description?: string; /** Lifts the logo (24px, 124px on desktop) without moving the form; on for every auth screen. */ raiseLogo?: boolean; children: ReactNode }) {
  const { data } = useQuery({ queryKey: ["login-panel"], queryFn: fetchLoginPanel, staleTime: 60_000, placeholderData: DEFAULT_LOGIN_PANEL });
  const panel = data ?? DEFAULT_LOGIN_PANEL;
  const brand = usePlatformBrand();
  const hasLogo = Boolean(brand && (brand.tokens.logo.dark.full || brand.tokens.logo.light.full));

  return (
    <div className="flex min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      <aside
        aria-label="About"
        className={`hidden flex-col gap-4 p-14 lg:flex lg:w-2/5 ${panel.verticalAlign === "top" ? "justify-start" : panel.verticalAlign === "bottom" ? "justify-end" : "justify-center"}`}
        style={{
          backgroundImage: `${panel.imageUrl ? `url("${panel.imageUrl}"), ` : ""}linear-gradient(135deg, ${panel.backgroundFrom}, ${panel.backgroundTo})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          color: panel.textColor,
        }}
      >
        <h2 className="max-w-md text-balance text-4xl font-bold leading-tight tracking-tight">{panel.heading}</h2>
        {panel.body ? <p className="max-w-md text-pretty text-lg opacity-90">{panel.body}</p> : null}
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center px-5 py-10 sm:px-8 lg:w-3/5 lg:flex-none">
        <div className="w-full max-w-[440px] space-y-8">
          <div className={`flex justify-center ${raiseLogo ? "relative -top-6 lg:-top-[124px]" : ""}`}>
            {hasLogo ? <PlatformLogo /> : <span className="text-3xl font-extrabold tracking-[0.2em]">{brand?.tokens.identity?.name?.toUpperCase() || "BCOM"}</span>}
          </div>
          {title ? (
            <div className="space-y-1.5 text-center">
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              {description ? <p className="text-sm text-[var(--muted-foreground)] text-balance">{description}</p> : null}
            </div>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
