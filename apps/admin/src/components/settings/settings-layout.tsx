import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@bs/ui";
import { SimpleSelect } from "../simple-select.tsx";
import { cn } from "@/lib/utils";
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
    <div className="mx-auto grid w-full max-w-6xl gap-3 px-4 py-6 md:px-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
      {/* Tablet / phone: one grouped section chooser above the content */}
      <div className="lg:hidden">
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

      {/* Desktop: grouped sticky sidebar */}
      <nav aria-label="Settings" className="hidden lg:sticky lg:top-6 lg:block lg:self-start">
        {groups.map((group) => (
          <div key={group.id} className={cn(groups.length > 1 && "pb-2 [&:not(:last-child)]:mb-2 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border")}>
            <h2 className="px-2 pb-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">{group.label}</h2>
            <ul className="grid gap-0.5">
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
          </div>
        ))}
      </nav>

      <main className="min-w-0">
        {canOpenSettingsPath(permissions, pathname) ? (
          <Outlet />
        ) : (
          <EmptyState
            icon={ShieldAlert}
            title="You do not have access to this section"
            description="Ask the store owner if you need to change these settings."
          />
        )}
      </main>
    </div>
  );
}
