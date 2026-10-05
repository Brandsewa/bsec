import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  Image as ImageIcon,
  MoreHorizontal,
  MoveDown,
  MoveUp,
  Package,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category } from "@bs/contracts";
import { Badge } from "@bs/ui";
import { Button } from "@bs/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@bs/ui";
import { Input } from "@bs/ui";
import { ConfirmDialog } from "@bs/ui";
import { ScrollTabs } from "@bs/ui";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

type CategoryStatusFilter = "all" | "active" | "featured" | "inactive";

const STATUS_TABS: ReadonlyArray<{ id: CategoryStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "featured", label: "Featured" },
  { id: "inactive", label: "Inactive" },
];

export interface CategoriesSearch {
  status?: CategoryStatusFilter | undefined;
  q?: string | undefined;
}

export const Route = createFileRoute("/_store/categories")({
  validateSearch: (raw: Record<string, unknown>): CategoriesSearch => ({
    status: (["all", "active", "featured", "inactive"] as const).includes(raw["status"] as CategoryStatusFilter)
      ? (raw["status"] as CategoryStatusFilter)
      : "all",
    q: typeof raw["q"] === "string" ? raw["q"] : undefined,
  }),
  pendingComponent: () => <PageSkeleton />,
  component: CategoriesPage,
});

export function CategoriesPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const queryClient = useQueryClient();

  const status = search.status ?? "all";
  const [queryText, setQueryText] = useState(search.q ?? "");
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const statsQuery = useQuery(orpc.admin.categories.stats.queryOptions());
  const categoriesQuery = useQuery({
    ...orpc.admin.categories.list.queryOptions({
      input: {
        status: status === "all" ? undefined : status,
        search: search.q?.trim() || undefined,
      },
    }),
    placeholderData: keepPreviousData,
  });

  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  // Reorder / move mutation
  const updateMutation = useMutation(
    orpc.admin.categories.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.stats.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to update category"));
      },
    }),
  );

  // Delete mutation
  const deleteMutation = useMutation(
    orpc.admin.categories.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Category deleted");
        setDeleteTarget(null);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.stats.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Could not delete category"));
      },
    }),
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      to: ".",
      replace: true,
      search: ((prev: Record<string, unknown>) => ({ ...prev, q: queryText.trim() || undefined })) as never,
    });
  };

  // Build tree structure
  const { roots, childrenMap } = useMemo(() => {
    const childrenMap = new Map<string, Category[]>();
    const roots: Category[] = [];

    for (const cat of categories) {
      if (!cat.parentId) {
        roots.push(cat);
      } else {
        const list = childrenMap.get(cat.parentId) ?? [];
        list.push(cat);
        childrenMap.set(cat.parentId, list);
      }
    }

    // Sort by position asc
    roots.sort((a, b) => a.position - b.position);
    for (const list of childrenMap.values()) {
      list.sort((a, b) => a.position - b.position);
    }

    return { roots, childrenMap };
  }, [categories]);

  // Flatten tree for display, respecting search expansion
  const flattenedRows = useMemo(() => {
    // If searching or filtering, flat view or auto-expand
    const isSearching = Boolean(search.q?.trim() || status !== "all");

    const result: Array<{ item: Category; level: number; hasChildren: boolean; isExpanded: boolean }> = [];

    function traverse(items: Category[], level: number) {
      for (const item of items) {
        const children = childrenMap.get(item.id) ?? [];
        const hasChildren = children.length > 0;
        const isExpanded = isSearching || expandedIds.has(item.id);

        result.push({ item, level, hasChildren, isExpanded });
        if (hasChildren && isExpanded) {
          traverse(children, level + 1);
        }
      }
    }

    traverse(roots, 0);
    return result;
  }, [roots, childrenMap, expandedIds, search.q, status]);

  const movePosition = (item: Category, delta: number, siblingList: Category[]) => {
    const index = siblingList.findIndex((s) => s.id === item.id);
    if (index < 0) return;
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= siblingList.length) return;

    const targetItem = siblingList[targetIndex];
    if (!targetItem) return;

    // Swap positions
    const currentPos = item.position;
    const targetPos = targetItem.position === currentPos ? (delta > 0 ? currentPos + 1 : currentPos - 1) : targetItem.position;

    updateMutation.mutate({ id: item.id, position: targetPos });
  };

  return (
    <PageContainer size="default">
      <PageHeader
        title="Categories"
        description="Organize your products into a clean, searchable hierarchy for storefront navigation."
        aside={
          <Button render={<Link to="/categories/new" />} size="default">
            <Plus className="mr-1.5 size-4" aria-hidden />
            Add category
          </Button>
        }
      />

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {statsQuery.isLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard label="Total Categories" value={statsQuery.data?.total ?? 0} />
            <MetricCard label="Active" value={statsQuery.data?.active ?? 0} />
            <MetricCard label="Inactive" value={statsQuery.data?.inactive ?? 0} />
            <MetricCard label="Top-level Parents" value={statsQuery.data?.parents ?? 0} />
            <MetricCard label="Products Assigned" value={statsQuery.data?.productsAssigned ?? 0} />
          </>
        )}
      </div>

      {/* Tabs & Search Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <ScrollTabs
          tabs={STATUS_TABS}
          value={status}
          onChange={(val: string) => {
            void navigate({
              to: ".",
              replace: true,
              search: ((prev: Record<string, unknown>) => ({ ...prev, status: val as CategoryStatusFilter })) as never,
            });
          }}
        />

        <form onSubmit={handleSearchSubmit} className="flex max-w-sm flex-1 items-center gap-2">
          <Input
            placeholder="Search categories..."
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            className="h-9"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
          {search.q && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQueryText("");
                void navigate({ to: ".", replace: true, search: ((prev: Record<string, unknown>) => ({ ...prev, q: undefined })) as never });
              }}
            >
              Clear
            </Button>
          )}
        </form>
      </div>

      {/* Tree-aware table */}
      <div className="rounded-lg border border-border bg-card">
        {categoriesQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading categories...</div>
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <FolderTree className="size-10 text-muted-foreground/60" aria-hidden />
            <h3 className="mt-4 text-base font-medium">No categories found</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {search.q ? "No categories match your search term." : "Create your first category to organize your catalog."}
            </p>
            {!search.q && (
              <Button render={<Link to="/categories/new" />} size="sm" className="mt-4">
                <Plus className="mr-1.5 size-4" aria-hidden />
                Add category
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground uppercase">
                <tr>
                  <th className="py-3 pr-4 pl-6">Category</th>
                  <th className="py-3 px-4">Slug / Path</th>
                  <th className="py-3 px-4 text-center">Products</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Featured</th>
                  <th className="py-3 px-4 text-center">Order</th>
                  <th className="py-3 pr-6 pl-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {flattenedRows.map(({ item, level, hasChildren, isExpanded }) => {
                  const siblings = item.parentId ? childrenMap.get(item.parentId) ?? [] : roots;
                  const siblingIdx = siblings.findIndex((s) => s.id === item.id);
                  const isFirst = siblingIdx === 0;
                  const isLast = siblingIdx === siblings.length - 1;

                  return (
                    <tr key={item.id} className="transition-colors hover:bg-muted/30">
                      <td className="py-3 pr-4 pl-6 font-medium">
                        <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 24}px` }}>
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggleExpand(item.id)}
                              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label={isExpanded ? "Collapse subcategories" : "Expand subcategories"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                            </button>
                          ) : (
                            <span className="size-4" />
                          )}

                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt=""
                              className="size-8 rounded border border-border object-cover"
                            />
                          ) : (
                            <div className="flex size-8 items-center justify-center rounded border border-border bg-muted/50 text-muted-foreground">
                              <ImageIcon className="size-4" />
                            </div>
                          )}

                          <div>
                            <Link
                              to="/categories/$id"
                              params={{ id: item.id }}
                              className="font-medium text-foreground hover:underline"
                            >
                              {item.name}
                            </Link>
                            {item.childrenCount ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                ({item.childrenCount} {item.childrenCount === 1 ? "sub" : "subs"})
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-xs font-mono text-muted-foreground">
                        /{item.slug}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <Badge variant="outline" className="font-normal">
                          <Package className="mr-1 size-3 text-muted-foreground" />
                          {item.productCount ?? 0}
                        </Badge>
                      </td>

                      <td className="py-3 px-4 text-center">
                        {item.isActive ? (
                          <Badge variant="default" className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Inactive
                          </Badge>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center">
                        {item.isFeatured ? (
                          <Badge variant="default" className="bg-amber-500/10 text-amber-700 dark:text-amber-400">
                            <Sparkles className="mr-1 size-3" />
                            Featured
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            disabled={isFirst || updateMutation.isPending}
                            onClick={() => movePosition(item, -1, siblings)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                            title="Move up"
                          >
                            <MoveUp className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={isLast || updateMutation.isPending}
                            onClick={() => movePosition(item, 1, siblings)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                            title="Move down"
                          >
                            <MoveDown className="size-3.5" />
                          </button>
                        </div>
                      </td>

                      <td className="py-3 pr-6 pl-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="sm" className="size-8 p-0" aria-label="Open menu">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem render={<Link to="/categories/$id" params={{ id: item.id }} />}>
                              Edit category
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => updateMutation.mutate({ id: item.id, isActive: !item.isActive })}
                            >
                              {item.isActive ? "Deactivate" : "Activate"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => updateMutation.mutate({ id: item.id, isFeatured: !item.isFeatured })}
                            >
                              {item.isFeatured ? "Unfeature" : "Feature"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteTarget(item)}
                            >
                              <Trash2 className="mr-2 size-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog with reason guards */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Category?"
        description={
          deleteTarget ? (
            <div className="space-y-2">
              <p>
                Are you sure you want to delete <strong>{deleteTarget.name}</strong>?
              </p>
              {(deleteTarget.childrenCount ?? 0) > 0 && (
                <p className="rounded-md bg-destructive/10 p-2 text-xs font-medium text-destructive">
                  ⚠️ This category has subcategories. You must reassign or delete them first.
                </p>
              )}
              {(deleteTarget.productCount ?? 0) > 0 && (
                <p className="rounded-md bg-amber-500/10 p-2 text-xs font-medium text-amber-800 dark:text-amber-400">
                  ⚠️ {deleteTarget.productCount} product(s) are assigned to this category. They will need to be reassigned.
                </p>
              )}
            </div>
          ) : (
            ""
          )
        }
        confirmLabel="Delete Category"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ id: deleteTarget.id });
          }
        }}
      />
    </PageContainer>
  );
}
