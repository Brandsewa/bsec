import { Menu } from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { UiLink } from "../lib/link.tsx";
import { Button } from "../components/button.tsx";
import { Sheet, SheetContent, SheetTitle } from "../components/sheet.tsx";

export interface NavItem {
  label: string;
  href: string;
  icon?: ComponentType<{ className?: string }>;
}
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/** The one item that matches the current path best (longest matching href), so /settings does not stay lit on /settings/taxes. */
function bestMatch(groups: NavGroup[], activeHref: string): string | undefined {
  let best: string | undefined;
  for (const g of groups) {
    for (const item of g.items) {
      const matches = activeHref === item.href || (item.href !== "/" && activeHref.startsWith(`${item.href}/`));
      if (matches && (best === undefined || item.href.length > best.length)) best = item.href;
    }
  }
  return best;
}

function NavList({ groups, activeHref, onNavigate }: { groups: NavGroup[]; activeHref: string; onNavigate?: () => void }) {
  const current = bestMatch(groups, activeHref);
  return (
    <nav className="grid gap-5" aria-label="Main">
      {groups.map((g, gi) => (
        <div key={g.label ?? gi} className="grid gap-0.5">
          {g.label ? (
            <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-foreground-muted">{g.label}</p>
          ) : null}
          {g.items.map((item) => {
            const active = item.href === current;
            const Icon = item.icon;
            return (
              <div key={item.href} onClickCapture={onNavigate}>
                <UiLink
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-foreground-light hover:bg-surface-200 hover:text-foreground max-md:h-touch",
                    active && "bg-surface-200 font-medium text-foreground",
                  )}
                >
                  {Icon ? <Icon className="size-4 shrink-0" /> : null}
                  {item.label}
                </UiLink>
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * Desktop: fixed left rail. Mobile (<768px): top bar + Sheet drawer, 40px touch targets.
 */
export function AppShell({
  brand,
  groups,
  activeHref,
  topRight,
  banner,
  children,
}: {
  brand: ReactNode;
  groups: NavGroup[];
  activeHref: string;
  topRight?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-dvh bg-dash-canvas md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-r border-border bg-dash-sidebar p-3 md:flex">
        <div className="flex h-8 items-center px-2">{brand}</div>
        <NavList groups={groups} activeHref={activeHref} />
      </aside>
      <div className="flex min-w-0 flex-col">
        {banner}
        <header className="flex h-12 items-center justify-between gap-2 border-b border-border bg-background px-3 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <Button variant="ghost" size="icon" aria-label="Open menu" onClick={() => setOpen(true)}>
              <Menu />
            </Button>
            {brand}
          </div>
          <div className="ml-auto flex items-center gap-2">{topRight}</div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="bg-dash-sidebar p-3">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="flex h-8 items-center px-2">{brand}</div>
          <NavList groups={groups} activeHref={activeHref} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
