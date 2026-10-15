import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, ArrowLeft, ArrowUp, CornerDownRight, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  ConfirmDialog,
  FieldLabel,
  InfoTip,
  Input,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SimpleSelect,
  Switch,
  Textarea,
  toast,
} from "@bs/ui";
import type { BlogCategoryItem } from "@bs/contracts";
import { MediaField } from "../../../components/media/media-field.tsx";
import { errorMessage } from "../../../lib/errors.ts";
import { orpc } from "../../../lib/orpc.ts";

export const Route = createFileRoute("/_store/online-store/blog_/categories")({
  pendingComponent: () => <PageSkeleton />,
  component: BlogCategoriesPage,
});

type Row = Omit<BlogCategoryItem, "children">;
interface Draft {
  id: string | null;
  name: string;
  slug: string;
  parentId: string;
  description: string;
  imageMediaId: string | null;
  isActive: boolean;
  seoTitle: string;
  seoDescription: string;
}

const emptyDraft = (parentId = ""): Draft => ({ id: null, name: "", slug: "", parentId, description: "", imageMediaId: null, isActive: true, seoTitle: "", seoDescription: "" });

function BlogCategoriesPage() {
  const queryClient = useQueryClient();
  const tree = useQuery(orpc.admin.blog.categories.list.queryOptions());
  const roots = useMemo(() => tree.data ?? [], [tree.data]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [moveTo, setMoveTo] = useState("");

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.blog.categories.list.key() });
  const reorder = useMutation(orpc.admin.blog.categories.reorder.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(errorMessage(e, "Could not reorder")) }));
  const remove = useMutation(
    orpc.admin.blog.categories.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Category deleted");
        setDeleteTarget(null);
        refresh();
      },
      onError: (e) => toast.error(errorMessage(e, "Could not delete the category")),
    }),
  );

  const move = (siblings: Row[], index: number, dir: -1 | 1) => {
    const next = siblings.map((s) => s.id);
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    const a = next[index];
    const b = next[j];
    if (!a || !b) return;
    next[index] = b;
    next[j] = a;
    reorder.mutate({ orderedIds: next });
  };

  const edit = (c: Row) =>
    setDraft({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parentId: c.parentId ?? "",
      description: c.description ?? "",
      imageMediaId: c.imageMediaId,
      isActive: c.isActive,
      seoTitle: c.seo?.title ?? "",
      seoDescription: c.seo?.description ?? "",
    });

  const moveOptions = useMemo(() => {
    const opts = [{ value: "", label: "No category (uncategorised)" }];
    for (const c of roots) {
      if (c.id !== deleteTarget?.id) opts.push({ value: c.id, label: c.name });
      for (const k of c.children ?? []) if (k.id !== deleteTarget?.id) opts.push({ value: k.id, label: `${c.name} › ${k.name}` });
    }
    return opts;
  }, [roots, deleteTarget]);

  const renderRow = (c: Row, siblings: Row[], index: number, depth: number) => (
    <li key={c.id} className="flex items-center gap-3 py-3 pr-4 pl-6" style={{ paddingLeft: depth ? 48 : undefined }}>
      {depth > 0 && <CornerDownRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{c.name}</span>
          {!c.isActive && <Badge variant="outline" className="text-muted-foreground">Hidden</Badge>}
        </div>
        <p className="font-mono text-xs text-muted-foreground">/blog/category/{c.slug}</p>
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{c.postCount} {c.postCount === 1 ? "post" : "posts"}</span>
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="sm" className="size-8 p-0" aria-label={`Move ${c.name} up`} disabled={index === 0 || reorder.isPending} onClick={() => move(siblings, index, -1)}>
          <ArrowUp className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" className="size-8 p-0" aria-label={`Move ${c.name} down`} disabled={index === siblings.length - 1 || reorder.isPending} onClick={() => move(siblings, index, 1)}>
          <ArrowDown className="size-4" />
        </Button>
        {depth === 0 && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(emptyDraft(c.id))}>
            <Plus className="mr-1 size-3.5" aria-hidden />
            Subcategory
          </Button>
        )}
        <Button variant="ghost" size="sm" className="size-8 p-0" aria-label={`Edit ${c.name}`} onClick={() => edit(c)}>
          <Pencil className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" className="size-8 p-0 text-destructive" aria-label={`Delete ${c.name}`} onClick={() => { setMoveTo(""); setDeleteTarget(c); }}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title="Blog categories"
        description="Group posts into categories and subcategories. Visitors can browse each one from the blog."
        aside={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" render={<Link to="/online-store/blog" />} nativeButton={false}>
              <ArrowLeft className="mr-1.5 size-4" aria-hidden />
              Posts
            </Button>
            <Button onClick={() => setDraft(emptyDraft())}>
              <Plus className="mr-1.5 size-4" aria-hidden />
              Add category
            </Button>
          </div>
        }
      />
      <PageSection>
        <div className="overflow-hidden rounded-xl bg-card shadow-xs">
          {tree.isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading categories...</div>
          ) : roots.length === 0 ? (
            <div className="flex flex-col items-center p-12 text-center">
              <FolderTree className="size-10 text-muted-foreground/60" aria-hidden />
              <h3 className="mt-4 text-base font-medium">No categories yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">Categories are optional. Add one to organise your posts.</p>
              <Button size="sm" className="mt-4" onClick={() => setDraft(emptyDraft())}>
                <Plus className="mr-1.5 size-4" aria-hidden />
                Add category
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {roots.map((c, i) => (
                <li key={c.id} className="list-none">
                  <ul>{renderRow(c, roots, i, 0)}</ul>
                  {(c.children ?? []).length > 0 && (
                    <ul className="divide-y divide-border/40 bg-muted/20">
                      {(c.children ?? []).map((k, j) => renderRow(k, c.children ?? [], j, 1))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageSection>

      <CategorySheet draft={draft} roots={roots} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); refresh(); }} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this category?"
        description={
          deleteTarget ? (
            <div className="grid gap-3">
              <p>
                <strong>{deleteTarget.name}</strong> will be deleted. Its subcategories move up to the top level. Posts are never deleted.
              </p>
              <div className="grid gap-1.5">
                <FieldLabel>Move its {deleteTarget.postCount} {deleteTarget.postCount === 1 ? "post" : "posts"} to</FieldLabel>
                <SimpleSelect ariaLabel="Move posts to" value={moveTo} onChange={setMoveTo} options={moveOptions} placeholder="No category" />
              </div>
            </div>
          ) : (
            ""
          )
        }
        confirmLabel="Delete category"
        destructive
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate({ id: deleteTarget.id, moveTo: moveTo || null })}
      />
    </PageContainer>
  );
}

function CategorySheet({ draft, roots, onClose, onSaved }: { draft: Draft | null; roots: BlogCategoryItem[]; onClose: () => void; onSaved: () => void }) {
  return (
    <Sheet open={Boolean(draft)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-[40%]">
        {draft && <CategoryForm key={draft.id ?? `new-${draft.parentId}`} initial={draft} roots={roots} onClose={onClose} onSaved={onSaved} />}
      </SheetContent>
    </Sheet>
  );
}

function CategoryForm({ initial, roots, onClose, onSaved }: { initial: Draft; roots: BlogCategoryItem[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(initial);
  const editing = initial.id !== null;
  // Only top-level categories can be parents, and a category that has subcategories cannot become one.
  const self = roots.find((r) => r.id === initial.id);
  const parentOptions = [{ value: "", label: "None (top level)" }].concat(
    self && (self.children ?? []).length > 0 ? [] : roots.filter((r) => r.id !== initial.id).map((r) => ({ value: r.id, label: r.name })),
  );
  const seo = { title: d.seoTitle.trim() || null, description: d.seoDescription.trim() || null };
  const create = useMutation(orpc.admin.blog.categories.create.mutationOptions({ onSuccess: () => { toast.success("Category added"); onSaved(); }, onError: (e) => toast.error(errorMessage(e, "Could not save")) }));
  const update = useMutation(orpc.admin.blog.categories.update.mutationOptions({ onSuccess: () => { toast.success("Category saved"); onSaved(); }, onError: (e) => toast.error(errorMessage(e, "Could not save")) }));
  const submit = () => {
    if (!d.name.trim()) return toast.error("Add a name first");
    const base = { name: d.name.trim(), slug: d.slug.trim() || undefined, parentId: d.parentId || null, description: d.description.trim() || null, imageMediaId: d.imageMediaId, isActive: d.isActive, seo };
    if (editing && initial.id) update.mutate({ id: initial.id, ...base });
    else create.mutate(base);
  };
  const pending = create.isPending || update.isPending;
  return (
    <>
      <SheetHeader>
        <SheetTitle>{editing ? "Edit category" : initial.parentId ? "Add subcategory" : "Add category"}</SheetTitle>
        <SheetDescription>Categories help visitors find related posts.</SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 overflow-y-auto px-6 py-4">
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="cat-name">Name *</FieldLabel>
          <Input id="cat-name" value={d.name} maxLength={120} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center gap-1.5">
            <FieldLabel htmlFor="cat-slug">Address</FieldLabel>
            <InfoTip>Used in the web address, for example /blog/category/guides. Created from the name when left empty.</InfoTip>
          </div>
          <Input id="cat-slug" value={d.slug} maxLength={120} className="font-mono text-sm" onChange={(e) => setD({ ...d, slug: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <FieldLabel>Parent category</FieldLabel>
          <SimpleSelect ariaLabel="Parent category" value={d.parentId} onChange={(v) => setD({ ...d, parentId: v })} options={parentOptions} placeholder="None (top level)" />
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="cat-desc">Description</FieldLabel>
            <span className="text-xs tabular-nums text-muted-foreground">{d.description.length}/300</span>
          </div>
          <Textarea id="cat-desc" rows={3} maxLength={300} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
        </div>
        <MediaField label="Image" value={d.imageMediaId} onChange={(id) => setD({ ...d, imageMediaId: id })} />
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <FieldLabel htmlFor="cat-active">Visible on the blog</FieldLabel>
            <InfoTip>Hiding a category also hides its posts from the blog until it is visible again.</InfoTip>
          </div>
          <Switch id="cat-active" checked={d.isActive} onCheckedChange={(v) => setD({ ...d, isActive: v })} />
        </div>
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="cat-seo-title">Search title</FieldLabel>
          <Input id="cat-seo-title" value={d.seoTitle} maxLength={120} onChange={(e) => setD({ ...d, seoTitle: e.target.value })} placeholder="Uses the name" />
        </div>
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="cat-seo-desc">Meta description</FieldLabel>
          <Textarea id="cat-seo-desc" rows={2} maxLength={320} value={d.seoDescription} onChange={(e) => setD({ ...d, seoDescription: e.target.value })} placeholder="Uses the description" />
        </div>
      </div>
      <SheetFooter className="px-6 pb-6">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={pending}>{pending ? "Saving..." : editing ? "Save category" : "Add category"}</Button>
      </SheetFooter>
    </>
  );
}
