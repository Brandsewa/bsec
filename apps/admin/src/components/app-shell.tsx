import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { NavGroup } from "@bs/ui";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

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

/** sidebar_state cookie is written by SidebarProvider; read it so a collapsed rail stays collapsed after reload. */
function savedOpen(): boolean {
  try {
    return !/(?:^|;\s*)sidebar_state=false/.test(document.cookie);
  } catch {
    return true;
  }
}

/**
 * Store admin shell. Desktop: left rail that collapses to icons (Ctrl/Cmd+B or the rail edge). Mobile: drawer opened
 * from the header trigger.
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
  const current = bestMatch(groups, activeHref);
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={savedOpen()}>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex h-8 items-center px-2 group-data-[collapsible=icon]:hidden">{brand}</div>
          </SidebarHeader>
          <SidebarContent>
            {groups.map((g, gi) => (
              <SidebarGroup key={g.label ?? gi}>
                {g.label ? <SidebarGroupLabel>{g.label}</SidebarGroupLabel> : null}
                <SidebarMenu>
                  {g.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={item.href === current}
                          tooltip={item.label}
                          render={<Link to={item.href} aria-current={item.href === current ? "page" : undefined} />}
                        >
                          {Icon ? <Icon /> : null}
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="min-w-0 bg-dash-canvas">
          {banner}
          <header className="flex h-12 items-center justify-between gap-2 border-b border-border bg-background px-3 md:px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger aria-label="Toggle sidebar" />
              <span className="md:hidden">{brand}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">{topRight}</div>
          </header>
          <main className="min-w-0 flex-1">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
