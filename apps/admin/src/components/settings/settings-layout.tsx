import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@bs/ui";
import { SimpleSelect } from "@bs/ui";
import { cn } from "@/lib/utils";
import { SettingsUpdateBanner } from "./settings-update.tsx";
import { activeSettingsItem, canOpenSettingsPath, visibleSettingsGroups } from "./settings-nav.ts";

/**
 * The Settings workspace. Desktop: a compact grouped navigation column that stays put while the content
 * column changes. Below `lg`: the same groups collapse into one accessible section chooser above the
 * content. Each section is its own route, so the URL and the browser's back/forward buttons follow the
 * selection. Grouping per the rebuild plan (docs/SETTINGS-REBUILD-PLAN.md §2).
 */
export function SettingsLayout({ permissions }: { permissions: readonly string[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  const groups = visibleSettingsGroups(permissions);
  const items = groups.flatMap((g) => g.items);
  const active = activeSettingsItem(items, pathname);

  return (
    <div className="flex min-h-[calc(100vh-3rem)] w-full flex-col lg:flex-row">
      {/* Tablet / phone: one grouped section chooser above the content */}
      <div className="border-b border-border bg-background p-4 lg:hidden">
        <SettingsUpdateBanner />
        <SimpleSelect
          ariaLabel="Settings section"
          value={active?.href ?? ""}
          onChange={(href) => void navigate({ to: href })}
          groups={groups.map((g) => ({
            label: g.label,
            options: g.items.map((i) => ({ value: i.href, label: i.label })),
          }))}
          options={items.map((i) => ({ value: i.href, label: i.label }))}
        />
      </div>

      {/* Desktop: docked secondary sidebar */}
      <aside
        aria-label="Settings navigation"
        className="hidden lg:flex lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-border lg:bg-background"
      >
        <div className="sticky top-0 flex max-h-[calc(100vh-3rem)] flex-col overflow-y-auto px-3 py-5">
          <div className="mb-2 px-2.5">
            <h1 className="text-xs font-semibold tracking-tight text-foreground">Settings</h1>
          </div>
          <nav aria-label="Settings" className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.id} className="flex flex-col gap-0.5">
                <h2 className="px-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                  {group.label}
                </h2>
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.id === active?.id;
                    return (
                      <li key={item.id}>
                        <Link
                          to={item.href}
                          activeOptions={{ exact: item.href === "/settings" }}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] leading-4 transition-colors",
                            isActive
                              ? "bg-accent font-medium text-accent-foreground"
                              : "font-normal text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          )}
                        >
                          <Icon
                            className={cn(
                              "size-3.5 shrink-0 transition-colors",
                              isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                            )}
                          />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main settings content: centered */}
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 lg:px-10 lg:py-8">
        <div className="mx-auto w-full max-w-3xl">
          <div className="hidden lg:block">
            <SettingsUpdateBanner />
          </div>
          {canOpenSettingsPath(permissions, pathname) ? (
            <Outlet />
          ) : (
            <EmptyState
              icon={ShieldAlert}
              title="You do not have access to this section"
              description="Ask the store owner if you need to change these settings."
            />
          )}
        </div>
      </main>
    </div>
  );
}
