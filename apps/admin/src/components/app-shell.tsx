import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  cn,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  TooltipProvider,
  type NavGroup,
} from "@bs/ui";

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
 * Store admin shell with collapsible grouped navigation. Desktop: left rail that collapses to icons (Ctrl/Cmd+B or the rail edge).
 * Mobile: drawer opened from the header trigger.
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

  const isGroupActive = (g: NavGroup) => {
    return g.items.some(
      (item) => activeHref === item.href || (item.href !== "/" && activeHref.startsWith(`${item.href}/`))
    );
  };

  const activeGroup = groups.find((g) => g.label && isGroupActive(g))?.label ?? null;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup);
  const [prevActiveGroup, setPrevActiveGroup] = useState<string | null>(activeGroup);

  if (activeGroup !== prevActiveGroup) {
    setPrevActiveGroup(activeGroup);
    if (activeGroup) {
      setOpenGroup(activeGroup);
    }
  }

  const settingsGroup = groups.find((g) => g.label === "Settings" || g.items.some((i) => i.href === "/settings"));
  const mainGroups = groups.filter((g) => g !== settingsGroup);

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={savedOpen()} style={{ "--sidebar-width": "16rem" } as React.CSSProperties}>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex h-8 items-center px-2 group-data-[collapsible=icon]:hidden">{brand}</div>
          </SidebarHeader>
          <SidebarContent className="flex flex-col justify-between">
            <SidebarGroup className="py-1">
              <SidebarMenu>
                {mainGroups.map((g) => {
                  const isCollapsible = Boolean(g.label && g.items.length > 1);
                  const Icon = g.icon ?? g.items[0]?.icon;
                  const isOpen = g.label ? openGroup === g.label : false;
                  const hasActiveChild = isGroupActive(g);

                  if (!isCollapsible) {
                    return g.items.map((item) => {
                      const ItemIcon = item.icon;
                      const active = item.href === current;
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            isActive={active}
                            tooltip={item.label}
                            render={<Link to={item.href} aria-current={active ? "page" : undefined} />}
                          >
                            {ItemIcon ? <ItemIcon /> : null}
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    });
                  }

                  const label = g.label ?? "";
                  const flyoutTooltip = {
                    align: "start" as const,
                    sideOffset: 8,
                    showArrow: false,
                    className:
                      "flex flex-col gap-0.5 min-w-48 p-1.5 bg-background text-foreground border border-border-soft rounded-xl shadow-xl z-50",
                    children: (
                      <div className="flex flex-col gap-1 w-full">
                        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground border-b border-border-soft">
                          {label}
                        </div>
                        <div className="flex flex-col gap-0.5">
                          {g.items.map((item) => {
                            const ItemIcon = item.icon;
                            const active = item.href === current;
                            return (
                              <Link
                                key={item.href}
                                to={item.href}
                                aria-current={active ? "page" : undefined}
                                className={cn(
                                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground/80 hover:bg-muted hover:text-foreground transition-colors cursor-pointer",
                                  active && "bg-muted font-medium text-foreground"
                                )}
                              >
                                {ItemIcon ? <ItemIcon className="size-4 shrink-0 text-muted-foreground" /> : null}
                                <span>{item.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ),
                  };

                  return (
                    <SidebarMenuItem
                      key={label}
                      onMouseEnter={() => setOpenGroup(label)}
                    >
                      <SidebarMenuButton
                        onMouseEnter={() => setOpenGroup(label)}
                        // Hovering already opens the group, so a toggle here would close it again on the same click.
                        onClick={() => {
                          setOpenGroup(label);
                        }}
                        tooltip={flyoutTooltip}
                        className={cn(
                          "justify-between font-normal",
                          hasActiveChild && !isOpen && "font-medium text-foreground bg-sidebar-accent/50"
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {Icon ? <Icon /> : null}
                          <span className="truncate">{g.label}</span>
                        </div>
                        <ChevronRight
                          className={cn(
                            "size-4 shrink-0 transition-transform duration-200 group-data-[collapsible=icon]:hidden",
                            isOpen && "rotate-90"
                          )}
                        />
                      </SidebarMenuButton>
                      <div
                        data-state={isOpen ? "open" : "closed"}
                        className="nav-accordion-content group-data-[collapsible=icon]:hidden"
                        aria-hidden={!isOpen}
                      >
                        <div>
                          <SidebarMenuSub>
                            {g.items.map((item) => {
                              const ItemIcon = item.icon;
                              const active = item.href === current;
                              return (
                                <SidebarMenuSubItem key={item.href}>
                                  <SidebarMenuSubButton
                                    isActive={active}
                                    tabIndex={isOpen ? 0 : -1}
                                    render={<Link to={item.href} aria-current={active ? "page" : undefined} />}
                                  >
                                    {ItemIcon ? <ItemIcon /> : null}
                                    <span>{item.label}</span>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </div>
                      </div>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>

            {settingsGroup ? (
              <SidebarGroup className="mt-auto border-t border-border-soft pt-2">
                <SidebarMenu>
                  {settingsGroup.items.map((item) => {
                    const Icon = item.icon;
                    const active = item.href === current;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={active}
                          tooltip={item.label}
                          render={<Link to={item.href} aria-current={active ? "page" : undefined} />}
                        >
                          {Icon ? <Icon /> : null}
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroup>
            ) : null}
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="min-w-0 bg-canvas">
          {banner}
          <header className="flex h-12 items-center justify-between gap-2 border-b border-border-soft bg-background px-3 md:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger aria-label="Toggle sidebar" />
              <span className="min-w-0 max-w-[7rem] truncate md:hidden">{brand}</span>
            </div>
            <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">{topRight}</div>
          </header>
          <main className="min-w-0 flex-1 bg-canvas">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
