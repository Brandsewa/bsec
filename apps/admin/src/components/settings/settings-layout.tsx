import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { SimpleSelect } from "../simple-select.tsx";
import { cn } from "@/lib/utils";
import { activeSettingsItem, SETTINGS_NAV } from "./settings-nav.ts";

/**
 * The Settings workspace. Desktop: a compact navigation column that stays put while the content column changes.
 * Below `lg`: the navigation collapses to a dropdown above the content. Each section is its own route, so the URL
 * and the browser's back/forward buttons follow the selection.
 */
export function SettingsLayout({ permissions }: { permissions: readonly string[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  const items = SETTINGS_NAV.filter((i) => !i.perm || permissions.includes(i.perm));
  const active = activeSettingsItem(items, pathname);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-3 px-4 py-6 md:px-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
      {/* Tablet / phone */}
      <div className="lg:hidden">
        <SimpleSelect
          ariaLabel="Settings section"
          value={active?.href ?? ""}
          options={items.map((i) => ({ value: i.href, label: i.label }))}
          onChange={(href) => void navigate({ to: href })}
        />
      </div>

      {/* Desktop */}
      <nav aria-label="Settings" className="hidden lg:sticky lg:top-6 lg:block lg:self-start">
        <h2 className="px-2 pb-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">Settings</h2>
        <ul className="grid gap-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === active?.id;
            return (
              <li key={item.id}>
                <Link
                  to={item.href}
                  activeOptions={{ exact: item.href === "/settings" }}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group flex items-start gap-2 rounded-md px-2 py-1 transition-colors hover:bg-background/70",
                    isActive && "bg-background shadow-xs ring-1 ring-border",
                  )}
                >
                  <Icon className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground", isActive && "text-primary")} />
                  <span className="min-w-0">
                    <span className={cn("block text-[0.8125rem] leading-5", isActive ? "font-semibold text-foreground" : "font-medium text-foreground-light")}>{item.label}</span>
                    <span className="block truncate text-[0.6875rem] leading-4 text-muted-foreground">{item.description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
