import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, CornerDownRight, Menu as MenuIcon, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormSkeleton,
  Input,
  Label,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  SimpleSelect,
  TableSkeleton,
  toast,
} from "@bs/ui";
import type { MenuItem } from "@bs/contracts";
import { orpc } from "../../../lib/orpc.ts";

type ItemType = MenuItem["type"];
const ITEM_TYPES: { id: ItemType; label: string }[] = [
  { id: "url", label: "Link" },
  { id: "page", label: "Page" },
  { id: "collection", label: "Collection" },
  { id: "product", label: "Product" },
  { id: "category", label: "Category" },
];
const MAX_DEPTH = 3;

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `m-${Math.random().toString(36).slice(2, 10)}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- immutable tree helpers (path = index list from root) ---
function updateAt(items: MenuItem[], path: number[], fn: (siblings: MenuItem[], idx: number) => MenuItem[]): MenuItem[] {
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

function moveItem(items: MenuItem[], path: number[], dir: -1 | 1): MenuItem[] {
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

function addChild(items: MenuItem[], path: number[]): MenuItem[] {
  const child: MenuItem = { id: newId(), title: "", url: "", type: "url" };
  if (path.length === 0) return [...items, child];
  return updateAt(items, path, (sibs, idx) =>
    sibs.map((it, i) => (i === idx ? { ...it, children: [...(it.children ?? []), child] } : it)),
  );
}

function findInvalid(items: MenuItem[], trail = ""): string | null {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it) continue;
    const where = `${trail}item ${i + 1}`;
    if (!it.title.trim()) return `${where}: enter a label`;
    if (!it.url.trim()) return `${where}: enter a link`;
    const nested = findInvalid(it.children ?? [], `${where} > `);
    if (nested) return nested;
  }
  return null;
}

function stripEmpty(items: MenuItem[]): MenuItem[] {
  return items.map((it) => {
    const { children, ...rest } = it;
    const kids = children && children.length > 0 ? stripEmpty(children) : undefined;
    return kids ? { ...rest, children: kids } : rest;
  });
}

function MenusLoading() {
  return (
    <PageSkeleton>
      <TableSkeleton rows={4} columns={2} />
    </PageSkeleton>
  );
}

export const Route = createFileRoute("/_store/online-store/menus")({
  pendingComponent: () => <MenusLoading />,
  component: MenusPage,
});

function QueryError({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm font-medium text-foreground">Could not load {what}</p>
      <p className="text-sm text-foreground-2">{message}</p>
      <Button size="sm" onClick={onRetry}>
        <RotateCcw className="size-3.5" aria-hidden />
        Retry
      </Button>
    </div>
  );
}

export function MenusPage() {
  const queryClient = useQueryClient();
  const menusQuery = useQuery(orpc.admin.menus.list.queryOptions());
  const [selectedHandle, setSelectedHandle] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const menus = menusQuery.data ?? [];
  const activeHandle = selectedHandle && menus.some((m) => m.handle === selectedHandle) ? selectedHandle : (menus[0]?.handle ?? null);

  const newButton = (
    <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
      <Plus className="mr-1.5 size-3.5" aria-hidden />
      New menu
    </Button>
  );

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Online Store", href: "/online-store/theme" }, { label: "Menus" }]} actions={menusQuery.data ? newButton : undefined} />
      <PageHeader title="Navigation Menus" description="Build the header, footer and other link menus shown on your storefront." />

      {menusQuery.isError ? (
        <QueryError what="menus" message={menusQuery.error.message} onRetry={() => void menusQuery.refetch()} />
      ) : !menusQuery.data ? (
        <MenusLoading />
      ) : menus.length === 0 ? (
        <EmptyState
          icon={MenuIcon}
          title="No menus yet"
          description="Create your first menu, for example a header or footer navigation, then add links to it."
          action={newButton}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <nav aria-label="Menus" className="grid content-start gap-1">
            {menus.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedHandle(m.handle)}
                aria-current={m.handle === activeHandle ? "true" : undefined}
                className={`rounded-md border px-3 py-2 text-left text-sm ${
                  m.handle === activeHandle ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-muted"
                }`}
              >
                <span className="block text-foreground">{m.name}</span>
                <span className="block font-mono text-xs text-muted-foreground">{m.handle}</span>
              </button>
            ))}
          </nav>
          {activeHandle ? <MenuEditorLoader key={activeHandle} handle={activeHandle} onDeleted={() => setSelectedHandle(null)} /> : null}
        </div>
      )}

      <CreateMenuDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(handle) => {
          setSelectedHandle(handle);
          void queryClient.invalidateQueries({ queryKey: orpc.admin.menus.list.key() });
        }}
      />
    </PageContainer>
  );
}

function CreateMenuDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (handle: string) => void;
}) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [touched, setTouched] = useState(false);
  const effectiveHandle = touched ? handle : slugify(name);
  const invalid = !name.trim() || !effectiveHandle;

  const create = useMutation(
    orpc.admin.menus.create.mutationOptions({
      onSuccess: (menu) => {
        toast.success(`Menu "${menu.name}" created.`);
        setName("");
        setHandle("");
        setTouched(false);
        onOpenChange(false);
        onCreated(menu.handle);
      },
      onError: (err: Error) => toast.error(`Could not create menu: ${err.message}`),
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) create.mutate({ name: name.trim(), handle: effectiveHandle, items: [] });
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>New menu</DialogTitle>
            <DialogDescription>The handle identifies the menu in the storefront, e.g. header or footer.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor="menu-name">Name</Label>
            <Input id="menu-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Header navigation" required />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="menu-handle">Handle</Label>
            <Input
              id="menu-handle"
              value={effectiveHandle}
              onChange={(e) => {
                setTouched(true);
                setHandle(slugify(e.target.value));
              }}
              placeholder="header"
              required
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={create.isPending} disabled={invalid}>
              Create menu
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MenuEditorLoader({ handle, onDeleted }: { handle: string; onDeleted: () => void }) {
  const query = useQuery(orpc.admin.menus.get.queryOptions({ input: { handle } }));
  if (query.isError) {
    return <QueryError what="this menu" message={query.error.message} onRetry={() => void query.refetch()} />;
  }
  if (!query.data) return <FormSkeleton fields={4} />;
  return (
    <MenuEditor
      key={`${query.data.id}:${query.data.updatedAt}`}
      menuId={query.data.id}
      handle={query.data.handle}
      initialName={query.data.name}
      initialItems={query.data.items}
      onDeleted={onDeleted}
    />
  );
}

function MenuEditor({
  menuId,
  handle,
  initialName,
  initialItems,
  onDeleted,
}: {
  menuId: string;
  handle: string;
  initialName: string;
  initialItems: MenuItem[];
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);
  const [items, setItems] = useState<MenuItem[]>(initialItems);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = name !== initialName || JSON.stringify(items) !== JSON.stringify(initialItems);
  const problem = !name.trim() ? "Menu name is required" : findInvalid(items);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.menus.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.menus.get.key({ input: { handle } }) }),
    ]);

  const save = useMutation(
    orpc.admin.menus.update.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Menu saved.");
      },
      onError: (err: Error) => toast.error(`Could not save menu: ${err.message}`),
    }),
  );

  const remove = useMutation(
    orpc.admin.menus.delete.mutationOptions({
      onSuccess: async () => {
        setConfirmDelete(false);
        await queryClient.invalidateQueries({ queryKey: orpc.admin.menus.list.key() });
        toast.success("Menu deleted.");
        onDeleted();
      },
      onError: (err: Error) => toast.error(`Could not delete menu: ${err.message}`),
    }),
  );

  const handleSave = () => {
    if (problem) {
      toast.error(problem);
      return;
    }
    save.mutate({ id: menuId, name: name.trim(), items: stripEmpty(items) });
  };

  return (
    <div className="grid content-start gap-4">
      <PageSection
        title={name || "Untitled menu"}
        description={`Handle: ${handle}`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)} disabled={remove.isPending}>
              <Trash2 className="mr-1.5 size-3.5" aria-hidden />
              Delete
            </Button>
            <Button
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setName(initialName);
                setItems(initialItems);
              }}
            >
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
              Discard
            </Button>
            <Button size="sm" variant="primary" loading={save.isPending} disabled={!dirty} onClick={handleSave}>
              <Save className="mr-1.5 size-3.5" aria-hidden />
              Save menu
            </Button>
          </div>
        }
      >
        <div className="grid gap-1">
          <Label htmlFor="menu-title">Menu name</Label>
          <Input id="menu-title" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!name.trim()} />
        </div>
      </PageSection>

      <PageSection
        title="Menu items"
        actions={
          <Button size="sm" onClick={() => setItems((prev) => addChild(prev, []))}>
            <Plus className="mr-1.5 size-3.5" aria-hidden />
            Add link
          </Button>
        }
      >
        {items.length === 0 ? (
          <EmptyState
            icon={MenuIcon}
            title="This menu has no links"
            description="Add a link to start building the menu."
            action={
              <Button size="sm" variant="primary" onClick={() => setItems((prev) => addChild(prev, []))}>
                <Plus className="mr-1.5 size-3.5" aria-hidden />
                Add link
              </Button>
            }
          />
        ) : (
          <ItemList items={items} path={[]} depth={1} setItems={setItems} />
        )}
      </PageSection>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this menu?</DialogTitle>
            <DialogDescription>
              &ldquo;{initialName}&rdquo; and all of its links will be removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate({ id: menuId })}>
              Delete menu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemList({
  items,
  path,
  depth,
  setItems,
}: {
  items: MenuItem[];
  path: number[];
  depth: number;
  setItems: (fn: (prev: MenuItem[]) => MenuItem[]) => void;
}) {
  return (
    <ul className={`grid gap-2 ${depth > 1 ? "ml-6 border-l border-border pl-3" : ""}`}>
      {items.map((item, index) => {
        const here = [...path, index];
        return (
          <li key={item.id} className="grid gap-2">
            <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 md:grid-cols-[1fr_1fr_9rem_auto] md:items-center">
              <Input
                aria-label="Link label"
                placeholder="Label"
                value={item.title}
                aria-invalid={!item.title.trim()}
                onChange={(e) => setItems((prev) => patchItem(prev, here, { title: e.target.value }))}
              />
              <Input
                aria-label="Link destination"
                placeholder="/collections/all or https://"
                value={item.url}
                aria-invalid={!item.url.trim()}
                onChange={(e) => setItems((prev) => patchItem(prev, here, { url: e.target.value }))}
              />
              <SimpleSelect
                ariaLabel="Link type"
                value={item.type}
                onChange={(v) => setItems((prev) => patchItem(prev, here, { type: v as ItemType }))}
                className="h-9"
                options={ITEM_TYPES.map((t) => ({ value: t.id, label: t.label }))}
              />
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => setItems((prev) => moveItem(prev, here, -1))}>
                  <ArrowUp />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => setItems((prev) => moveItem(prev, here, 1))}
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Add sub-link"
                  disabled={depth >= MAX_DEPTH}
                  onClick={() => setItems((prev) => addChild(prev, here))}
                >
                  <CornerDownRight />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Remove link" onClick={() => setItems((prev) => removeItem(prev, here))}>
                  <Trash2 />
                </Button>
              </div>
            </div>
            {item.children && item.children.length > 0 ? (
              <ItemList items={item.children} path={here} depth={depth + 1} setItems={setItems} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
