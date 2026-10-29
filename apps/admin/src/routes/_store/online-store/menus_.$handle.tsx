import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Eye,
  GripVertical,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DetailSkeleton,
  EmptyState,
  Input,
  Label,
  PageContainer,
  PageSkeleton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SimpleSelect,
  Switch,
  toast,
} from "@bs/ui";
import type { FilterDisplay, FilterItemConfig, FilterKind, MenuDetail, MenuItem, MenuItemType } from "@bs/contracts";
import { errorMessage } from "../../../lib/errors.ts";
import { orpc } from "../../../lib/orpc.ts";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `m-${Math.random().toString(36).slice(2, 10)}`;
}

const SAFE_SCHEMES = /^(\/|#|https:\/\/|mailto:|tel:)/i;

const LINK_TYPE_OPTIONS: { value: MenuItemType; label: string }[] = [
  { value: "page", label: "Page" },
  { value: "collection", label: "Collection" },
  { value: "category", label: "Category" },
  { value: "brand", label: "Brand" },
  { value: "product", label: "Product" },
  { value: "home", label: "Home" },
  { value: "blog", label: "Blog" },
  { value: "blog_category", label: "Blog category" },
  { value: "blog_post", label: "Blog post" },
  { value: "policy", label: "Policies" },
  { value: "search", label: "Search" },
  { value: "account", label: "Account / Login" },
  { value: "url", label: "Custom URL" },
];

const FILTER_KIND_OPTIONS: { value: FilterKind; label: string }[] = [
  { value: "availability", label: "Availability" },
  { value: "price", label: "Price Range" },
  { value: "brand", label: "Brand" },
  { value: "category", label: "Category" },
  { value: "collection", label: "Collection" },
  { value: "tag", label: "Product Tag" },
  { value: "option", label: "Product Option (Color, Size, etc.)" },
];

const FILTER_DISPLAY_OPTIONS: { value: FilterDisplay; label: string }[] = [
  { value: "checkbox", label: "Checkboxes (multi-select)" },
  { value: "range", label: "Range Slider (numbers / price)" },
  { value: "swatch", label: "Swatches (colors / visual buttons)" },
];

// --- Tree manipulation helpers ---
interface FlatItem {
  id: string;
  item: MenuItem;
  path: number[];
  depth: number;
}

function flattenItems(items: MenuItem[], path: number[] = [], depth = 1): FlatItem[] {
  const result: FlatItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const currentPath = [...path, i];
    result.push({ id: item.id, item, path: currentPath, depth });
    if (item.children && item.children.length > 0) {
      result.push(...flattenItems(item.children, currentPath, depth + 1));
    }
  }
  return result;
}

function updateAt(items: MenuItem[], path: number[], fn: (sibs: MenuItem[], idx: number) => MenuItem[]): MenuItem[] {
  const [head, ...rest] = path;
  if (head === undefined) return items;
  if (rest.length === 0) return fn(items, head);
  return items.map((it, i) =>
    i === head ? { ...it, children: updateAt(it.children ?? [], rest, fn) } : it,
  );
}

function patchItem(items: MenuItem[], path: number[], patch: Partial<MenuItem>): MenuItem[] {
  return updateAt(items, path, (sibs, idx) => sibs.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
}

function removeItem(items: MenuItem[], path: number[]): MenuItem[] {
  return updateAt(items, path, (sibs, idx) => sibs.filter((_, i) => i !== idx));
}

function moveSibling(items: MenuItem[], path: number[], dir: -1 | 1): MenuItem[] {
  return updateAt(items, path, (sibs, idx) => {
    const target = idx + dir;
    if (target < 0 || target >= sibs.length) return sibs;
    const next = [...sibs];
    const a = next[idx];
    const b = next[target];
    if (!a || !b) return sibs;
    next[idx] = b;
    next[target] = a;
    return next;
  });
}

function indentItem(items: MenuItem[], path: number[]): MenuItem[] {
  const idx = path[path.length - 1];
  if (idx === undefined || idx === 0) return items;
  const parentPath = path.slice(0, -1);
  return updateAt(items, parentPath, (sibs) => {
    const current = sibs[idx];
    const prev = sibs[idx - 1];
    if (!current || !prev) return sibs;
    const updatedPrev = {
      ...prev,
      children: [...(prev.children ?? []), current],
    };
    const nextSibs = sibs.filter((_, i) => i !== idx);
    nextSibs[idx - 1] = updatedPrev;
    return nextSibs;
  });
}

function outdentItem(items: MenuItem[], path: number[]): MenuItem[] {
  if (path.length <= 1) return items; // already top-level
  const parentIdx = path[path.length - 2];
  const currentIdx = path[path.length - 1];
  if (parentIdx === undefined || currentIdx === undefined) return items;

  const grandparentPath = path.slice(0, -2);
  return updateAt(items, grandparentPath, (grandSibs) => {
    const parent = grandSibs[parentIdx];
    if (!parent) return grandSibs;
    const current = (parent.children ?? [])[currentIdx];
    if (!current) return grandSibs;

    const remainingChildren = (parent.children ?? []).filter((_, i) => i !== currentIdx);
    const updatedParent = { ...parent, children: remainingChildren };

    const nextGrandSibs = [...grandSibs];
    nextGrandSibs[parentIdx] = updatedParent;
    nextGrandSibs.splice(parentIdx + 1, 0, current);
    return nextGrandSibs;
  });
}

const MAX_MENU_DEPTH = 3;
/** Horizontal drag distance that counts as one level of nesting. */
const NEST_STEP_PX = 36;

/** After a drop, drag distance to the right nests the item under the one above it; to the left lifts it a level. */
function applySidewaysNesting(items: MenuItem[], id: string, dx: number): MenuItem[] {
  if (Math.abs(dx) < NEST_STEP_PX) return items;
  const flat = flattenItems(items);
  const at = flat.find((f) => f.id === id);
  if (!at) return items;
  return dx > 0 ? indentItem(items, at.path) : outdentItem(items, at.path);
}

/** How many levels this item and its children take (an item with no children is 1). */
function subtreeDepth(item: MenuItem): number {
  return 1 + Math.max(0, ...(item.children ?? []).map(subtreeDepth));
}

function treeDepth(items: MenuItem[]): number {
  return Math.max(0, ...items.map(subtreeDepth));
}

/** Take an item (with its children) out of the tree. */
function extractById(items: MenuItem[], id: string): { items: MenuItem[]; node: MenuItem | null } {
  let node: MenuItem | null = null;
  const walk = (list: MenuItem[]): MenuItem[] =>
    list.flatMap((it) => {
      if (it.id === id) {
        node = it;
        return [];
      }
      return [it.children && it.children.length > 0 ? { ...it, children: walk(it.children) } : it];
    });
  const next = walk(items);
  return { items: next, node };
}

/** Put `node` next to the item `targetId`, as its sibling before or after it. */
function insertBeside(items: MenuItem[], targetId: string, node: MenuItem, where: "before" | "after"): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (it.id === targetId) {
      if (where === "before") out.push(node);
      out.push(it);
      if (where === "after") out.push(node);
    } else {
      out.push(it.children && it.children.length > 0 ? { ...it, children: insertBeside(it.children, targetId, node, where) } : it);
    }
  }
  return out;
}

function containsId(item: MenuItem, id: string): boolean {
  return item.id === id || (item.children ?? []).some((c) => containsId(c, id));
}

function addChild(items: MenuItem[], path: number[]): MenuItem[] {
  const child: MenuItem = { id: newId(), title: "", url: "/", type: "url" };
  if (path.length === 0) return [...items, child];
  return updateAt(items, path, (sibs, idx) =>
    sibs.map((it, i) => (i === idx ? { ...it, children: [...(it.children ?? []), child] } : it)),
  );
}

export const Route = createFileRoute("/_store/online-store/menus_/$handle")({
  pendingComponent: () => (
    <PageSkeleton>
      <DetailSkeleton />
    </PageSkeleton>
  ),
  component: EditMenuRoute,
});

/**
 * Ids of items the storefront leaves out: a page item whose page is not published (the store never links to a page that cannot open),
 * and everything nested under such an item, so a dropdown can vanish because its parent or its children are unpublished.
 */
function hiddenItemIds(items: MenuItem[], pageStatus: Map<string, string>): Set<string> {
  const out = new Set<string>();
  const walk = (list: MenuItem[], parentHidden: boolean) => {
    for (const it of list) {
      const hidden = parentHidden || (it.type === "page" && !!it.targetId && pageStatus.has(it.targetId) && pageStatus.get(it.targetId) !== "published");
      if (hidden) out.add(it.id);
      if (it.children && it.children.length > 0) walk(it.children, hidden);
    }
  };
  walk(items, false);
  return out;
}

function SortableNavigationRow({
  flat,
  hidden,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onIndent,
  onOutdent,
  onAddSubItem,
  canMoveUp,
  canMoveDown,
  canIndent,
  canOutdent,
}: {
  flat: FlatItem;
  hidden: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onIndent: () => void;
  onOutdent: () => void;
  onAddSubItem: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canIndent: boolean;
  canOutdent: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: flat.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const depthPadding = flat.depth === 1 ? "" : flat.depth === 2 ? "pl-8" : "pl-16";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors ${depthPadding}`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag handle to reorder"
          className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground touch-none"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {flat.depth > 1 ? (
          <CornerDownRight className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate">
              {flat.item.title || <span className="italic text-muted-foreground">Untitled item</span>}
            </span>
            <Badge variant="outline" className="text-xs uppercase shrink-0 font-normal">
              {flat.item.type}
            </Badge>
            {flat.item.openInNewTab ? (
              <Badge variant="secondary" className="text-[10px] shrink-0 font-normal">
                New tab
              </Badge>
            ) : null}
            {hidden ? (
              <Badge variant="outline" className="text-[10px] shrink-0 font-normal text-amber-700 dark:text-amber-400" title="This item, or the item it sits under, links to a page that is not published, so the store leaves it out of the menu. Publish the page to show it.">
                Not shown on store
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0 ml-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={!canMoveUp}
          onClick={onMoveUp}
          title="Move up"
          aria-label="Move up"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={!canMoveDown}
          onClick={onMoveDown}
          title="Move down"
          aria-label="Move down"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={!canOutdent}
          onClick={onOutdent}
          title="Outdent (level up)"
          aria-label="Outdent"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={!canIndent}
          onClick={onIndent}
          title="Indent (nest under previous)"
          aria-label="Indent"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>

        {flat.depth < 3 ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={onAddSubItem}
            title="Add sub-item"
            aria-label="Add sub-item"
          >
            <Plus className="h-4 w-4" />
          </Button>
        ) : null}

        <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
          title="Delete"
          aria-label="Delete item"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SortableFilterRow({
  item,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  item: MenuItem;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const filter = item.filter;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag handle to reorder filter"
          className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground touch-none"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate">
              {filter?.label || <span className="italic text-muted-foreground">Untitled filter</span>}
            </span>
            <Badge variant="outline" className="text-xs uppercase shrink-0 font-normal">
              {filter?.kind}
            </Badge>
            <Badge variant="secondary" className="text-xs shrink-0 font-normal">
              {filter?.display}
            </Badge>
            {filter?.collapsed ? (
              <Badge variant="outline" className="text-[10px] shrink-0 font-normal text-muted-foreground">
                Collapsed
              </Badge>
            ) : null}
          </div>
          {filter?.kind === "option" && filter.optionName ? (
            <p className="text-xs text-muted-foreground truncate">Option: {filter.optionName}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0 ml-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={!canMoveUp}
          onClick={onMoveUp}
          title="Move up"
          aria-label="Move up"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={!canMoveDown}
          onClick={onMoveDown}
          title="Move down"
          aria-label="Move down"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
          title="Delete"
          aria-label="Delete filter"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function HeaderPreviewStrip({ items }: { items: MenuItem[] }) {
  return (
    <Card className="relative z-20 overflow-visible">
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Header Preview
            </span>
          </div>
          <span className="text-xs text-muted-foreground">Simulated storefront header navigation</span>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <nav className="flex items-center gap-6 text-sm font-medium">
          <span className="font-bold tracking-tight text-foreground/80 shrink-0 select-none">STORE</span>
          <div className="flex items-center gap-5 flex-wrap">
            {items.length === 0 ? (
              <span className="text-xs italic text-muted-foreground">No menu items configured</span>
            ) : (
              items.map((it) => (
                <div key={it.id} className="relative group">
                  <div className="flex items-center gap-1 hover:text-primary cursor-default text-foreground/90 transition-colors py-1">
                    <span>{it.title || "Untitled"}</span>
                    {it.children && it.children.length > 0 ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    ) : null}
                  </div>
                  {it.children && it.children.length > 0 ? (
                    <div className="absolute top-full left-0 hidden group-hover:flex flex-col bg-popover text-popover-foreground border border-border shadow-md rounded-md py-1.5 px-1 min-w-[160px] z-20">
                      {it.children.map((child) => (
                        <div key={child.id} className="relative group/sub">
                          <div className="flex items-center justify-between px-3 py-1.5 rounded-sm text-xs hover:bg-accent hover:text-accent-foreground cursor-default">
                            <span>{child.title || "Untitled"}</span>
                            {child.children && child.children.length > 0 ? (
                              <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            ) : null}
                          </div>
                          {child.children && child.children.length > 0 ? (
                            <div className="absolute top-0 left-full hidden group-hover/sub:flex flex-col bg-popover text-popover-foreground border border-border shadow-md rounded-md py-1.5 px-1 min-w-[150px] z-30">
                              {child.children.map((sub) => (
                                <span
                                  key={sub.id}
                                  className="px-3 py-1.5 rounded-sm text-xs hover:bg-accent hover:text-accent-foreground cursor-default"
                                >
                                  {sub.title || "Untitled"}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </nav>
      </CardContent>
    </Card>
  );
}

function MenuEditorForm({ menu }: { menu: MenuDetail }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Queries for link picker resources
  const pagesQuery = useQuery(orpc.admin.pages.list.queryOptions());
  const collectionsQuery = useQuery(orpc.admin.collections.list.queryOptions({ input: {} }));
  const categoriesQuery = useQuery(orpc.admin.categories.list.queryOptions());
  const blogCategoriesQuery = useQuery(orpc.admin.blog.categories.list.queryOptions());
  const blogPostsQuery = useQuery(orpc.admin.blog.posts.list.queryOptions({ input: { status: "published", limit: 100 } }));
  const brandsQuery = useQuery(orpc.admin.brands.list.queryOptions());
  const productsQuery = useQuery(orpc.admin.products.list.queryOptions({ input: {} }));

  // Local state initialized directly from props
  const [name, setName] = useState(menu.name);
  const [items, setItems] = useState<MenuItem[]>(menu.items as MenuItem[]);

  const initialJson = useMemo(
    () => JSON.stringify({ name: menu.name, items: menu.items }),
    [menu.name, menu.items],
  );

  const isDirty = useMemo(() => {
    return JSON.stringify({ name, items }) !== initialJson;
  }, [name, items, initialJson]);

  // Unsaved changes blocker
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  });

  // Drawer states
  const [editingItemPath, setEditingItemPath] = useState<number[] | null>(null);
  const [itemDrawerOpen, setItemDrawerOpen] = useState(false);
  const [itemFormTitle, setItemFormTitle] = useState("");
  const [itemFormType, setItemFormType] = useState<MenuItemType>("url");
  const [itemFormTargetId, setItemFormTargetId] = useState("");
  const [itemFormUrl, setItemFormUrl] = useState("");
  const [itemFormOpenInNewTab, setItemFormOpenInNewTab] = useState(false);
  const [itemFormTitleTouched, setItemFormTitleTouched] = useState(false);

  // Filter drawer states
  const [editingFilterIdx, setEditingFilterIdx] = useState<number | null>(null);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [filterFormKind, setFilterFormKind] = useState<FilterKind>("availability");
  const [filterFormLabel, setFilterFormLabel] = useState("");
  const [filterFormDisplay, setFilterFormDisplay] = useState<FilterDisplay>("checkbox");
  const [filterFormOptionName, setFilterFormOptionName] = useState("");
  const [filterFormCollapsed, setFilterFormCollapsed] = useState(false);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const flatItems = useMemo(() => flattenItems(items), [items]);
  const hiddenIds = useMemo(() => hiddenItemIds(items, new Map((pagesQuery.data ?? []).map((p) => [p.id, p.status ?? (p.publishedVersionId ? "published" : "draft")]))), [items, pagesQuery.data]);

  const updateMutation = useMutation(
    orpc.admin.menus.update.mutationOptions({
      onSuccess: async () => {
        toast.success("Menu saved");
        await queryClient.invalidateQueries({ queryKey: orpc.admin.menus.list.key() });
        await queryClient.invalidateQueries({
          queryKey: orpc.admin.menus.get.key({ input: { handle: menu.handle } }),
        });
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Menu title cannot be empty");
      return;
    }

    // Validate navigation URLs
    if (menu.kind === "navigation") {
      for (const f of flatItems) {
        if (!f.item.title.trim()) {
          toast.error("All menu items must have a title");
          return;
        }
        if (f.item.type === "url" && f.item.url) {
          if (!SAFE_SCHEMES.test(f.item.url.trim())) {
            toast.error(`Invalid URL scheme for item "${f.item.title}". Only /, #, https:, mailto:, tel: allowed.`);
            return;
          }
          if (f.item.openInNewTab && !/^https:\/\//i.test(f.item.url.trim())) {
            toast.error(`Only https: links can open in a new tab (item "${f.item.title}")`);
            return;
          }
        }
      }
    }

    updateMutation.mutate({
      id: menu.id,
      name: trimmed,
      items,
    });
  };

  // Drag and drop handler for flat list
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    if (!over) return;
    // Dropped back on itself: a sideways drag still nests it under the item above, or lifts it out one level.
    if (active.id === over.id) {
      if (menu.kind !== "filter" && Math.abs(delta.x) >= NEST_STEP_PX) {
        const nested = applySidewaysNesting(items, String(active.id), delta.x);
        if (treeDepth(nested) <= MAX_MENU_DEPTH) setItems(nested);
        else toast.error("Menus can be nested up to 3 levels deep");
      }
      return;
    }

    if (menu.kind === "filter") {
      const oldIndex = items.findIndex((it) => it.id === active.id);
      const newIndex = items.findIndex((it) => it.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setItems(arrayMove(items, oldIndex, newIndex));
      }
      return;
    }

    // Navigation items: dropping on another row moves the item there, and dragging sideways nests or un-nests it.
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = flatItems.findIndex((f) => f.id === activeId);
    const to = flatItems.findIndex((f) => f.id === overId);
    const activeFlat = flatItems[from];
    const overFlat = flatItems[to];
    if (!activeFlat || !overFlat) return;
    // An item cannot be dropped inside itself.
    if (containsId(activeFlat.item, overId)) return;
    const taken = extractById(items, activeId);
    if (!taken.node) return;
    const next = insertBeside(taken.items, overId, taken.node, from < to ? "after" : "before");
    if (treeDepth(next) > MAX_MENU_DEPTH) {
      toast.error("Menus can be nested up to 3 levels deep");
      return;
    }
    setItems(applySidewaysNesting(next, activeId, delta.x));
  };

  // Item Drawer Actions
  const openAddItemDrawer = (_parentPath?: number[]) => {
    setEditingItemPath(null);
    setItemFormTitle("");
    setItemFormType("url");
    setItemFormTargetId("");
    setItemFormUrl("/");
    setItemFormOpenInNewTab(false);
    setItemFormTitleTouched(false);
    setItemDrawerOpen(true);
  };

  const openEditItemDrawer = (flat: FlatItem) => {
    setEditingItemPath(flat.path);
    setItemFormTitle(flat.item.title);
    setItemFormType(flat.item.type);
    setItemFormTargetId(flat.item.targetId ?? "");
    setItemFormUrl(flat.item.url);
    setItemFormOpenInNewTab(Boolean(flat.item.openInNewTab));
    setItemFormTitleTouched(true);
    setItemDrawerOpen(true);
  };

  const handleLinkTypeChange = (newType: MenuItemType) => {
    setItemFormType(newType);
    setItemFormTargetId("");

    switch (newType) {
      case "home":
        if (!itemFormTitleTouched || !itemFormTitle) setItemFormTitle("Home");
        setItemFormUrl("/");
        break;
      case "blog":
        if (!itemFormTitleTouched || !itemFormTitle) setItemFormTitle("Blog");
        setItemFormUrl("/blog");
        break;
      case "policy":
        if (!itemFormTitleTouched || !itemFormTitle) setItemFormTitle("Policies");
        setItemFormUrl("/policies");
        break;
      case "search":
        if (!itemFormTitleTouched || !itemFormTitle) setItemFormTitle("Search");
        setItemFormUrl("/search");
        break;
      case "account":
        if (!itemFormTitleTouched || !itemFormTitle) setItemFormTitle("Account");
        setItemFormUrl("/account/login");
        break;
      case "url":
        setItemFormUrl("/");
        break;
      default:
        setItemFormUrl("");
        break;
    }
  };

  const handleResourceSelect = (id: string, nameOrTitle: string, defaultPath: string) => {
    setItemFormTargetId(id);
    if (!itemFormTitleTouched || !itemFormTitle) {
      setItemFormTitle(nameOrTitle);
    }
    setItemFormUrl(defaultPath);
  };

  const handleSaveItemForm = () => {
    const title = itemFormTitle.trim();
    if (!title) {
      toast.error("Please enter a title for the menu item");
      return;
    }
    if (itemFormType === "url") {
      const url = itemFormUrl.trim();
      if (!url || !SAFE_SCHEMES.test(url)) {
        toast.error("URL must start with /, #, https://, mailto:, or tel:");
        return;
      }
      if (itemFormOpenInNewTab && !/^https:\/\//i.test(url)) {
        toast.error("Only https:// URLs can be opened in a new tab");
        return;
      }
    }

    const payload: Partial<MenuItem> = {
      title,
      type: itemFormType,
      targetId: itemFormTargetId || undefined,
      url: itemFormUrl.trim(),
      openInNewTab: itemFormOpenInNewTab,
    };

    if (editingItemPath !== null) {
      // Edit existing
      setItems(patchItem(items, editingItemPath, payload));
    } else {
      // Add new top-level
      const newItem: MenuItem = {
        id: newId(),
        title,
        type: itemFormType,
        targetId: itemFormTargetId || undefined,
        url: itemFormUrl.trim(),
        openInNewTab: itemFormOpenInNewTab,
      };
      setItems([...items, newItem]);
    }

    setItemDrawerOpen(false);
  };

  // Filter Drawer Actions
  const openAddFilterDrawer = () => {
    setEditingFilterIdx(null);
    setFilterFormKind("availability");
    setFilterFormLabel("Availability");
    setFilterFormDisplay("checkbox");
    setFilterFormOptionName("");
    setFilterFormCollapsed(false);
    setFilterDrawerOpen(true);
  };

  const openEditFilterDrawer = (idx: number, item: MenuItem) => {
    setEditingFilterIdx(idx);
    const f = item.filter;
    setFilterFormKind(f?.kind ?? "availability");
    setFilterFormLabel(f?.label ?? "");
    setFilterFormDisplay(f?.display ?? "checkbox");
    setFilterFormOptionName(f?.optionName ?? "");
    setFilterFormCollapsed(Boolean(f?.collapsed));
    setFilterDrawerOpen(true);
  };

  const handleFilterKindChange = (kind: FilterKind) => {
    setFilterFormKind(kind);
    switch (kind) {
      case "availability":
        setFilterFormLabel("Availability");
        setFilterFormDisplay("checkbox");
        break;
      case "price":
        setFilterFormLabel("Price");
        setFilterFormDisplay("range");
        break;
      case "brand":
        setFilterFormLabel("Brand");
        setFilterFormDisplay("checkbox");
        break;
      case "category":
        setFilterFormLabel("Category");
        setFilterFormDisplay("checkbox");
        break;
      case "collection":
        setFilterFormLabel("Collection");
        setFilterFormDisplay("checkbox");
        break;
      case "tag":
        setFilterFormLabel("Tag");
        setFilterFormDisplay("checkbox");
        break;
      case "option":
        setFilterFormLabel("Color");
        setFilterFormOptionName("Color");
        setFilterFormDisplay("swatch");
        break;
    }
  };

  const handleSaveFilterForm = () => {
    const label = filterFormLabel.trim();
    if (!label) {
      toast.error("Please enter a filter label");
      return;
    }
    if (filterFormKind === "option" && !filterFormOptionName.trim()) {
      toast.error("Please specify which option name to filter by (e.g. Color or Size)");
      return;
    }

    const filterConfig: FilterItemConfig = {
      kind: filterFormKind,
      label,
      display: filterFormDisplay,
      optionName: filterFormKind === "option" ? filterFormOptionName.trim() : undefined,
      collapsed: filterFormCollapsed,
    };

    const filterItem: MenuItem = {
      id: editingFilterIdx !== null ? items[editingFilterIdx]?.id ?? newId() : newId(),
      title: label,
      url: "",
      type: "filter",
      filter: filterConfig,
    };

    if (editingFilterIdx !== null) {
      const next = [...items];
      next[editingFilterIdx] = filterItem;
      setItems(next);
    } else {
      setItems([...items, filterItem]);
    }

    setFilterDrawerOpen(false);
  };

  return (
    <PageContainer>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate({ to: "/online-store/menus" })}
            className="h-8 w-8 p-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{name}</h1>
              <Badge variant={menu.kind === "filter" ? "secondary" : "default"}>
                {menu.kind === "filter" ? "Filter Menu" : "Navigation"}
              </Badge>
              {menu.isProtected ? (
                <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">
                  Default menu
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">Handle: {menu.handle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleSave}
            disabled={!isDirty || updateMutation.isPending}
            className="min-w-[100px]"
          >
            <Save className="h-4 w-4 mr-1.5" />
            {updateMutation.isPending ? "Saving..." : "Save menu"}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Menu Title Setting */}
        <Card>
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <div>
              <CardTitle className="text-base">Menu Settings</CardTitle>
              <CardDescription>Title and identifier for this menu.</CardDescription>
            </div>
            <div className="flex w-full items-center gap-3 sm:max-w-md">
              <Label htmlFor="edit-menu-title" className="shrink-0">
                Title
              </Label>
              <Input
                id="edit-menu-title"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Main menu"
              />
            </div>
          </CardContent>
        </Card>

        {/* Live Preview Strip for Navigation */}
        {menu.kind === "navigation" ? <HeaderPreviewStrip items={items} /> : null}

        {/* Items Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {menu.kind === "filter" ? "Filter Facets" : "Menu Items"}
                </CardTitle>
                <CardDescription>
                  {menu.kind === "filter"
                    ? "Drag facets to reorder how they appear in the collection sidebar filter."
                    : "Drag handles or use buttons to reorder and nest items up to 3 levels deep."}
                </CardDescription>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  menu.kind === "filter" ? openAddFilterDrawer() : openAddItemDrawer()
                }
              >
                <Plus className="h-4 w-4 mr-1" />
                {menu.kind === "filter" ? "Add filter" : "Add item"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <EmptyState
                title={menu.kind === "filter" ? "No filter facets configured" : "No menu items"}
                description={
                  menu.kind === "filter"
                    ? "Add product filters like price range, brand, availability, or color swatches."
                    : "Add links to pages, collections, categories, or custom URLs."
                }
                action={
                  <Button
                    size="sm"
                    onClick={() =>
                      menu.kind === "filter" ? openAddFilterDrawer() : openAddItemDrawer()
                    }
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {menu.kind === "filter" ? "Add filter" : "Add item"}
                  </Button>
                }
              />
            ) : menu.kind === "filter" ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={items.map((it) => it.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {items.map((it, idx) => (
                      <SortableFilterRow
                        key={it.id}
                        item={it}
                        onEdit={() => openEditFilterDrawer(idx, it)}
                        onDelete={() => setItems(items.filter((_, i) => i !== idx))}
                        onMoveUp={() => setItems(moveSibling(items, [idx], -1))}
                        onMoveDown={() => setItems(moveSibling(items, [idx], 1))}
                        canMoveUp={idx > 0}
                        canMoveDown={idx < items.length - 1}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={flatItems.map((f) => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {flatItems.map((flat) => {
                      const idx = flat.path[flat.path.length - 1] ?? 0;
                      return (
                        <SortableNavigationRow
                          key={flat.id}
                          flat={flat}
                          hidden={hiddenIds.has(flat.item.id)}
                          onEdit={() => openEditItemDrawer(flat)}
                          onDelete={() => setItems(removeItem(items, flat.path))}
                          onMoveUp={() => setItems(moveSibling(items, flat.path, -1))}
                          onMoveDown={() => setItems(moveSibling(items, flat.path, 1))}
                          onIndent={() => setItems(indentItem(items, flat.path))}
                          onOutdent={() => setItems(outdentItem(items, flat.path))}
                          onAddSubItem={() => setItems(addChild(items, flat.path))}
                          canMoveUp={idx > 0}
                          canMoveDown={true}
                          canIndent={flat.depth < 3 && idx > 0}
                          canOutdent={flat.depth > 1}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add / Edit Navigation Item Sheet */}
      <Sheet open={itemDrawerOpen} onOpenChange={setItemDrawerOpen}>
        <SheetContent className="overflow-y-auto p-0">
          <SheetHeader className="border-b border-border p-5 sm:p-8">
            <SheetTitle>{editingItemPath !== null ? "Edit menu item" : "Add menu item"}</SheetTitle>
            <SheetDescription>
              Choose a resource target or custom URL and provide a label.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 p-5 sm:p-8">
            <div className="space-y-1.5">
              <Label htmlFor="item-title">Item label</Label>
              <Input
                id="item-title"
                placeholder="e.g. Catalog or About Us"
                value={itemFormTitle}
                onChange={(e) => {
                  setItemFormTitleTouched(true);
                  setItemFormTitle(e.target.value);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="item-type">Link Type</Label>
              <SimpleSelect
                value={itemFormType}
                onChange={(val: string) => handleLinkTypeChange(val as MenuItemType)}
                options={LINK_TYPE_OPTIONS}
              />
            </div>

            {/* Resource pickers based on Link Type */}
            {itemFormType === "page" ? (
              <div className="space-y-1.5">
                <Label>Select Page</Label>
                <SimpleSelect
                  value={itemFormTargetId}
                  onChange={(id: string) => {
                    const page = (pagesQuery.data ?? []).find((p) => p.id === id);
                    if (page) {
                      handleResourceSelect(page.id, page.title, `/pages/${page.slug}`);
                    }
                  }}
                  options={[
                    { value: "", label: "-- Choose a page --" },
                    ...(pagesQuery.data ?? []).map((p) => ({
                      value: p.id,
                      label: p.title,
                    })),
                  ]}
                />
              </div>
            ) : null}

            {itemFormType === "collection" ? (
              <div className="space-y-1.5">
                <Label>Select Collection</Label>
                <SimpleSelect
                  value={itemFormTargetId}
                  onChange={(id: string) => {
                    const col = (collectionsQuery.data ?? []).find((c) => c.id === id);
                    if (col) {
                      handleResourceSelect(col.id, col.title, `/collections/${col.slug}`);
                    }
                  }}
                  options={[
                    { value: "", label: "-- Choose a collection --" },
                    ...(collectionsQuery.data ?? []).map((c) => ({
                      value: c.id,
                      label: c.title,
                    })),
                  ]}
                />
              </div>
            ) : null}

            {itemFormType === "category" ? (
              <div className="space-y-1.5">
                <Label>Select Category</Label>
                <SimpleSelect
                  value={itemFormTargetId}
                  onChange={(id: string) => {
                    const cat = (categoriesQuery.data ?? []).find((c) => c.id === id);
                    if (cat) {
                      handleResourceSelect(cat.id, cat.name, `/categories/${cat.slug}`);
                    }
                  }}
                  options={[
                    { value: "", label: "-- Choose a category --" },
                    ...(categoriesQuery.data ?? []).map((c) => ({
                      value: c.id,
                      label: c.name,
                    })),
                  ]}
                />
              </div>
            ) : null}

            {itemFormType === "blog_category" ? (
              <div className="space-y-1.5">
                <Label>Select Blog category</Label>
                <SimpleSelect
                  value={itemFormTargetId}
                  onChange={(id: string) => {
                    for (const c of blogCategoriesQuery.data ?? []) {
                      const hit = c.id === id ? c : (c.children ?? []).find((k) => k.id === id);
                      if (hit) handleResourceSelect(hit.id, hit.name, `/blog/category/${hit.parentId ? `${c.slug}/${hit.slug}` : hit.slug}`);
                    }
                  }}
                  options={[
                    { value: "", label: "-- Choose a blog category --" },
                    ...(blogCategoriesQuery.data ?? []).flatMap((c) => [
                      { value: c.id, label: c.name },
                      ...(c.children ?? []).map((k) => ({ value: k.id, label: `${c.name} › ${k.name}` })),
                    ]),
                  ]}
                />
              </div>
            ) : null}

            {itemFormType === "blog_post" ? (
              <div className="space-y-1.5">
                <Label>Select Blog post</Label>
                <SimpleSelect
                  value={itemFormTargetId}
                  onChange={(id: string) => {
                    const post = (blogPostsQuery.data?.items ?? []).find((p) => p.id === id);
                    if (post) handleResourceSelect(post.id, post.title, `/blog/${post.slug}`);
                  }}
                  options={[
                    { value: "", label: "-- Choose a published post --" },
                    ...(blogPostsQuery.data?.items ?? []).map((p) => ({ value: p.id, label: p.title })),
                  ]}
                />
              </div>
            ) : null}

            {itemFormType === "brand" ? (
              <div className="space-y-1.5">
                <Label>Select Brand</Label>
                <SimpleSelect
                  value={itemFormTargetId}
                  onChange={(id: string) => {
                    const br = (brandsQuery.data ?? []).find((b) => b.id === id);
                    if (br) {
                      handleResourceSelect(br.id, br.name, `/collections/all?brand=${br.slug}`);
                    }
                  }}
                  options={[
                    { value: "", label: "-- Choose a brand --" },
                    ...(brandsQuery.data ?? []).map((b) => ({
                      value: b.id,
                      label: b.name,
                    })),
                  ]}
                />
              </div>
            ) : null}

            {itemFormType === "product" ? (
              <div className="space-y-1.5">
                <Label>Select Product</Label>
                <SimpleSelect
                  value={itemFormTargetId}
                  onChange={(id: string) => {
                    const prod = (productsQuery.data?.items ?? []).find((p) => p.id === id);
                    if (prod) {
                      handleResourceSelect(prod.id, prod.title, `/products/${prod.slug}`);
                    }
                  }}
                  options={[
                    { value: "", label: "-- Choose a product --" },
                    ...(productsQuery.data?.items ?? []).map((p) => ({
                      value: p.id,
                      label: p.title,
                    })),
                  ]}
                />
              </div>
            ) : null}

            {itemFormType === "url" ? (
              <div className="space-y-1.5">
                <Label htmlFor="item-url">Target URL</Label>
                <Input
                  id="item-url"
                  placeholder="e.g. /custom-path or https://external.com"
                  value={itemFormUrl}
                  onChange={(e) => setItemFormUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Allowed schemes: /, #, https://, mailto:, tel:
                </p>
              </div>
            ) : (
              itemFormUrl ? (
                <p className="text-xs text-muted-foreground">
                  Links to <span className="font-mono">{itemFormUrl}</span> automatically.
                </p>
              ) : null
            )}

            <div className="pt-2 border-t border-border flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="item-tab" className="text-sm">
                  Open in new tab
                </Label>
                <p className="text-xs text-muted-foreground">
                  Only allowed for external https:// links
                </p>
              </div>
              <Switch
                id="item-tab"
                checked={itemFormOpenInNewTab}
                onCheckedChange={setItemFormOpenInNewTab}
                disabled={!/^https:\/\//i.test(itemFormUrl)}
              />
            </div>
          </div>

          <SheetFooter className="border-t border-border p-5 sm:p-8">
            <Button variant="outline" onClick={() => setItemDrawerOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveItemForm}>Done</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Add / Edit Filter Facet Sheet */}
      <Sheet open={filterDrawerOpen} onOpenChange={setFilterDrawerOpen}>
        <SheetContent className="overflow-y-auto p-0">
          <SheetHeader className="border-b border-border p-5 sm:p-8">
            <SheetTitle>{editingFilterIdx !== null ? "Edit filter facet" : "Add filter facet"}</SheetTitle>
            <SheetDescription>
              Configure a faceted search filter for the catalog.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 p-5 sm:p-8">
            <div className="space-y-1.5">
              <Label htmlFor="filter-kind">Filter Kind</Label>
              <SimpleSelect
                value={filterFormKind}
                onChange={(val: string) => handleFilterKindChange(val as FilterKind)}
                options={FILTER_KIND_OPTIONS}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filter-label">Display Label</Label>
              <Input
                id="filter-label"
                placeholder="e.g. Availability or Color"
                value={filterFormLabel}
                onChange={(e) => setFilterFormLabel(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filter-display">Display Mode</Label>
              <SimpleSelect
                value={filterFormDisplay}
                onChange={(val: string) => setFilterFormDisplay(val as FilterDisplay)}
                options={FILTER_DISPLAY_OPTIONS}
              />
            </div>

            {filterFormKind === "option" ? (
              <div className="space-y-1.5">
                <Label htmlFor="filter-option">Product Option Name</Label>
                <Input
                  id="filter-option"
                  placeholder="e.g. Color or Size"
                  value={filterFormOptionName}
                  onChange={(e) => setFilterFormOptionName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Must match the name of the option attribute on your products (case-insensitive).
                </p>
              </div>
            ) : null}

            <div className="pt-2 border-t border-border flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="filter-collapsed" className="text-sm">
                  Collapsed by default
                </Label>
                <p className="text-xs text-muted-foreground">
                  Start with the facet collapsed in the sidebar
                </p>
              </div>
              <Switch
                id="filter-collapsed"
                checked={filterFormCollapsed}
                onCheckedChange={setFilterFormCollapsed}
              />
            </div>
          </div>

          <SheetFooter className="border-t border-border p-5 sm:p-8">
            <Button variant="outline" onClick={() => setFilterDrawerOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveFilterForm}>Done</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Unsaved changes confirmation dialog */}
      <ConfirmDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title="Discard unsaved changes?"
        description="You have unsaved changes to this menu that will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => blocker.proceed?.()}
      />
    </PageContainer>
  );
}

export function EditMenuRoute() {
  const { handle } = Route.useParams();
  const menuQuery = useQuery(orpc.admin.menus.get.queryOptions({ input: { handle } }));

  if (menuQuery.isLoading || !menuQuery.data) {
    return (
      <PageSkeleton>
        <DetailSkeleton />
      </PageSkeleton>
    );
  }

  return (
    <MenuEditorForm
      key={`${menuQuery.data.id}-${menuQuery.data.updatedAt}`}
      menu={menuQuery.data}
    />
  );
}
