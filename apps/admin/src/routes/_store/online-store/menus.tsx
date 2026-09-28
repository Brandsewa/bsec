import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  ExternalLink,
  Menu as MenuIcon,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MetricCard,
  MetricCardSkeleton,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  toast,
} from "@bs/ui";

interface MenuItem {
  id: string;
  title: string;
  url: string;
  openInNewTab?: boolean;
  children?: MenuItem[];
}

interface MenuDef {
  handle: string;
  name: string;
  description: string;
  items: MenuItem[];
}

const initialMenus: MenuDef[] = [
  {
    handle: "header",
    name: "Header Navigation",
    description: "Main desktop navigation bar and mobile drawer menu",
    items: [
      { id: "m1", title: "Home", url: "/" },
      {
        id: "m2",
        title: "Shop All",
        url: "/products",
        children: [
          { id: "m2-1", title: "New Arrivals", url: "/collections/new-arrivals" },
          { id: "m2-2", title: "Best Sellers", url: "/collections/best-sellers" },
          { id: "m2-3", title: "Sustainable Home", url: "/collections/home-goods" },
        ],
      },
      { id: "m3", title: "About Us", url: "/about-us" },
      { id: "m4", title: "Contact", url: "/contact" },
    ],
  },
  {
    handle: "footer",
    name: "Footer Navigation",
    description: "Secondary links displayed across the bottom of every storefront page",
    items: [
      { id: "f1", title: "Privacy Policy", url: "/privacy" },
      { id: "f2", title: "Terms of Service", url: "/terms" },
      { id: "f3", title: "Shipping & Returns", url: "/shipping" },
      { id: "f4", title: "Instagram", url: "https://instagram.com/brandsewa", openInNewTab: true },
    ],
  },
  {
    handle: "quick-links",
    name: "Customer Care",
    description: "Help desk and customer support links",
    items: [
      { id: "q1", title: "Track Your Order", url: "/account/orders" },
      { id: "q2", title: "Size Guide", url: "/pages/size-guide" },
      { id: "q3", title: "Store Locations", url: "/locations" },
    ],
  },
];

let menuCounter = 100;
function getNextMenuId() {
  return `m-${++menuCounter}`;
}

export const Route = createFileRoute("/_store/online-store/menus")({
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    </PageSkeleton>
  ),
  component: MenusManagement,
});

function MenusManagement() {
  const [menus, setMenus] = useState<MenuDef[]>(initialMenus);
  const [activeHandle, setActiveHandle] = useState<string>("header");
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [itemTitle, setItemTitle] = useState("");
  const [itemUrl, setItemUrl] = useState("");
  const [itemNewTab, setItemNewTab] = useState(false);
  const [parentItemId, setParentItemId] = useState<string>("root");

  const currentMenu = menus.find((m) => m.handle === activeHandle) ?? menus[0];

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemTitle.trim() || !itemUrl.trim() || !currentMenu) return;

    const newItem: MenuItem = {
      id: getNextMenuId(),
      title: itemTitle.trim(),
      url: itemUrl.trim(),
      openInNewTab: itemNewTab,
    };


    let updatedItems: MenuItem[];
    if (parentItemId === "root") {
      updatedItems = [...currentMenu.items, newItem];
    } else {
      updatedItems = currentMenu.items.map((item) => {
        if (item.id === parentItemId) {
          return {
            ...item,
            children: [...(item.children ?? []), newItem],
          };
        }
        return item;
      });
    }

    setMenus((prev) =>
      prev.map((m) => (m.handle === currentMenu.handle ? { ...m, items: updatedItems } : m))
    );

    setIsAddItemOpen(false);
    setItemTitle("");
    setItemUrl("");
    setItemNewTab(false);
    setParentItemId("root");
    toast.success(`Added link "${newItem.title}" to ${currentMenu.name}`);
  };

  const handleRemoveItem = (itemId: string) => {
    if (!currentMenu) return;
    const filterItems = (list: MenuItem[]): MenuItem[] =>
      list
        .filter((item) => item.id !== itemId)
        .map((item) => (item.children ? { ...item, children: filterItems(item.children) } : item));

    const updated = filterItems(currentMenu.items);
    setMenus((prev) =>
      prev.map((m) => (m.handle === currentMenu.handle ? { ...m, items: updated } : m))
    );
    toast.info("Menu item removed");
  };

  const handleMoveTopLevel = (index: number, direction: "up" | "down") => {
    if (!currentMenu) return;
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= currentMenu.items.length) return;

    const items = [...currentMenu.items];
    const temp = items[index];
    const target = items[targetIdx];
    if (temp && target) {
      items[index] = target;
      items[targetIdx] = temp;
      setMenus((prev) =>
        prev.map((m) => (m.handle === currentMenu.handle ? { ...m, items } : m))
      );
    }
  };

  const handleSave = () => {
    toast.success(`Navigation menu "${currentMenu?.name}" saved successfully!`);
  };

  const totalLinks = menus.reduce((acc, m) => {
    const countItems = (items: MenuItem[]): number =>
      items.reduce((s, i) => s + 1 + (i.children ? countItems(i.children) : 0), 0);
    return acc + countItems(m.items);
  }, 0);

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Online Store", href: "/online-store/theme" }, { label: "Navigation" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm" onClick={() => setIsAddItemOpen(true)}>
              <Plus className="mr-1.5 size-3.5" aria-hidden />
              Add menu item
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave}>
              <Save className="mr-1.5 size-3.5" aria-hidden />
              Save changes
            </Button>
          </div>
        }
      />

      <PageHeader
        title="Storefront Navigation"
        description="Organize header dropdowns, footer links, and support navigation across your store."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Configured Menus" value={menus.length} icon={MenuIcon} />
        <MetricCard label="Total Links" value={totalLinks} />
        <MetricCard label="Active Menu" value={currentMenu?.name ?? "None"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: Menu Switcher */}
        <div className="space-y-4 lg:col-span-4">
          <PageSection title="Menus">
            <div className="space-y-2">
              {menus.map((menu) => (
                <button
                  key={menu.handle}
                  type="button"
                  onClick={() => setActiveHandle(menu.handle)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    activeHandle === menu.handle
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border hover:bg-surface-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{menu.name}</span>
                    <span className="font-mono text-xs text-foreground-lighter">{menu.handle}</span>
                  </div>
                  <p className="mt-1 text-xs text-foreground-muted">{menu.description}</p>
                  <span className="mt-2 inline-block text-[11px] font-medium text-foreground-lighter">
                    {menu.items.length} top-level links
                  </span>
                </button>
              ))}
            </div>
          </PageSection>
        </div>

        {/* Right: Menu Tree Editor */}
        <div className="space-y-4 lg:col-span-8">
          {currentMenu && (
            <PageSection
              title={`Editing: ${currentMenu.name}`}
              description={currentMenu.description}
              actions={
                <Button variant="default" size="sm" onClick={() => setIsAddItemOpen(true)}>
                  <Plus className="mr-1.5 size-3.5" />
                  Add link
                </Button>
              }
            >
              <div className="space-y-3">
                {currentMenu.items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-8 text-center text-foreground-muted">
                    This menu has no items yet.
                  </div>
                ) : (
                  currentMenu.items.map((item, idx) => (
                    <div key={item.id} className="space-y-2">
                      {/* Top-level Item */}
                      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-50 p-3">
                        <div className="flex items-center gap-3">
                          <span className="flex size-6 items-center justify-center rounded bg-surface-200 text-xs font-semibold text-foreground-muted">
                            {idx + 1}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-foreground">{item.title}</span>
                              {item.openInNewTab && (
                                <ExternalLink className="size-3 text-foreground-lighter" />
                              )}
                            </div>
                            <span className="font-mono text-xs text-foreground-lighter">{item.url}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={idx === 0}
                            onClick={() => handleMoveTopLevel(idx, "up")}
                          >
                            <ArrowUp className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={idx === currentMenu.items.length - 1}
                            onClick={() => handleMoveTopLevel(idx, "down")}
                          >
                            <ArrowDown className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveItem(item.id)}
                          >
                            <Trash2 className="size-3.5 text-rose-500" />
                          </Button>
                        </div>
                      </div>

                      {/* Nested Children */}
                      {item.children && item.children.length > 0 && (
                        <div className="ml-8 space-y-1.5 border-l-2 border-border/80 pl-4">
                          {item.children.map((child) => (
                            <div
                              key={child.id}
                              className="flex items-center justify-between rounded-md border border-border/60 bg-surface px-3 py-2"
                            >
                              <div className="flex items-center gap-2">
                                <CornerDownRight className="size-3.5 text-foreground-lighter" />
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-medium text-foreground">
                                      {child.title}
                                    </span>
                                    {child.openInNewTab && (
                                      <ExternalLink className="size-2.5 text-foreground-lighter" />
                                    )}
                                  </div>
                                  <span className="font-mono text-[10px] text-foreground-lighter">
                                    {child.url}
                                  </span>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveItem(child.id)}
                              >
                                <Trash2 className="size-3 text-rose-500" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </PageSection>
          )}
        </div>
      </div>

      {/* Add Menu Item Dialog */}
      <Dialog open={isAddItemOpen} onOpenChange={setIsAddItemOpen}>
        <DialogContent>
          <form onSubmit={handleAddItem}>
            <DialogHeader>
              <DialogTitle>Add Menu Link</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-1">
                <Label htmlFor="itemTitle">Link Text</Label>
                <Input
                  id="itemTitle"
                  value={itemTitle}
                  onChange={(e) => setItemTitle(e.target.value)}
                  placeholder="e.g. Summer Essentials, About Us"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="itemUrl">Destination URL</Label>
                <Input
                  id="itemUrl"
                  value={itemUrl}
                  onChange={(e) => setItemUrl(e.target.value)}
                  placeholder="e.g. /collections/summer or https://example.com"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="parentItem">Nest Under (Dropdown Parent)</Label>
                <select
                  id="parentItem"
                  value={parentItemId}
                  onChange={(e) => setParentItemId(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
                >
                  <option value="root">None (Top-level item)</option>
                  {currentMenu?.items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  id="newTab"
                  type="checkbox"
                  checked={itemNewTab}
                  onChange={(e) => setItemNewTab(e.target.checked)}
                  className="rounded border-border text-primary"
                />
                <Label htmlFor="newTab" className="cursor-pointer text-xs">
                  Open link in a new browser tab
                </Label>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="default" type="button">
                  Cancel
                </Button>
              </DialogClose>
              <Button variant="primary" type="submit">
                Add Item
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
