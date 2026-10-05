import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Boxes,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  MoreHorizontal,
  Package,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Collection } from "@bs/contracts";
import { Badge } from "@bs/ui";
import { Button } from "@bs/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@bs/ui";
import { Input } from "@bs/ui";
import { ConfirmDialog } from "@bs/ui";
import { ScrollTabs } from "@bs/ui";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

type CollectionStatusFilter = "all" | "active" | "draft";
type CollectionTypeFilter = "all" | "manual" | "automated";

const STATUS_TABS: ReadonlyArray<{ id: CollectionStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "draft", label: "Draft" },
];

export interface CollectionsSearch {
  status?: CollectionStatusFilter | undefined;
  type?: CollectionTypeFilter | undefined;
  q?: string | undefined;
}

export const Route = createFileRoute("/_store/collections")({
  validateSearch: (raw: Record<string, unknown>): CollectionsSearch => ({
    status: (["all", "active", "draft"] as const).includes(raw["status"] as CollectionStatusFilter)
      ? (raw["status"] as CollectionStatusFilter)
      : "all",
    type: (["all", "manual", "automated"] as const).includes(raw["type"] as CollectionTypeFilter)
      ? (raw["type"] as CollectionTypeFilter)
      : "all",
    q: typeof raw["q"] === "string" ? raw["q"] : undefined,
  }),
  pendingComponent: () => <PageSkeleton />,
  component: CollectionsPage,
});

export function CollectionsPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const queryClient = useQueryClient();

  const status = search.status ?? "all";
  const [queryText, setQueryText] = useState(search.q ?? "");
  const [deleteTarget, setDeleteTarget] = useState<Collection | null>(null);

  const statsQuery = useQuery(orpc.admin.collections.stats.queryOptions());
  const collectionsQuery = useQuery({
    ...orpc.admin.collections.list.queryOptions({
      input: {
        status: status === "all" ? undefined : status,
        type: search.type === "all" ? undefined : search.type,
        search: search.q?.trim() || undefined,
      },
    }),
    placeholderData: keepPreviousData,
  });

  const collections = collectionsQuery.data ?? [];

  const updateMutation = useMutation(
    orpc.admin.collections.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.stats.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to update collection"));
      },
    }),
  );

  const deleteMutation = useMutation(
    orpc.admin.collections.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Collection deleted");
        setDeleteTarget(null);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.collections.stats.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Could not delete collection"));
      },
    }),
  );

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      to: ".",
      replace: true,
      search: ((prev: Record<string, unknown>) => ({ ...prev, q: queryText.trim() || undefined })) as never,
    });
  };

  return (
    <PageContainer size="default">
      <PageHeader
        title="Collections"
        description="Group products manually or with automated condition rules to build merchandising pages."
        aside={
          <Button render={<Link to="/collections/new" />} size="default">
            <Plus className="mr-1.5 size-4" aria-hidden />
            Create collection
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {statsQuery.isLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard label="Total Collections" value={statsQuery.data?.total ?? 0} />
            <MetricCard label="Active" value={statsQuery.data?.active ?? 0} />
            <MetricCard label="Drafts" value={statsQuery.data?.draft ?? 0} />
            <MetricCard label="Manual" value={statsQuery.data?.manual ?? 0} />
            <MetricCard label="Automated" value={statsQuery.data?.automated ?? 0} />
            <MetricCard label="Indexed by Google" value={statsQuery.data?.indexable ?? 0} />
          </>
        )}
      </div>

      {/* Tabs & Search Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <ScrollTabs
          tabs={STATUS_TABS}
          value={status}
          onChange={(val) => {
            void navigate({
              to: ".",
              replace: true,
              search: ((prev: Record<string, unknown>) => ({ ...prev, status: val as CollectionStatusFilter })) as never,
            });
          }}
        />

        <form onSubmit={handleSearchSubmit} className="flex max-w-sm flex-1 items-center gap-2">
          <Input
            placeholder="Search collections..."
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
                void navigate({
                  to: ".",
                  replace: true,
                  search: ((prev: Record<string, unknown>) => ({ ...prev, q: undefined })) as never,
                });
              }}
            >
              Clear
            </Button>
          )}
        </form>
      </div>

      {/* Collections Table */}
      <div className="rounded-lg border border-border bg-card">
        {collectionsQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading collections...</div>
        ) : collections.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Layers className="size-10 text-muted-foreground/60" aria-hidden />
            <h3 className="mt-4 text-base font-medium">No collections found</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {search.q ? "No collections match your search filter." : "Create manual or automated product collections."}
            </p>
            {!search.q && (
              <Button render={<Link to="/collections/new" />} size="sm" className="mt-4">
                <Plus className="mr-1.5 size-4" aria-hidden />
                Create collection
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground uppercase">
                <tr>
                  <th className="py-3 pr-4 pl-6">Collection</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4 text-center">Products</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Search Engines</th>
                  <th className="py-3 pr-6 pl-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {collections.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-muted/30">
                    <td className="py-3 pr-4 pl-6 font-medium">
                      <div className="flex items-center gap-3">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="size-10 rounded border border-border object-cover"
                          />
                        ) : (
                          <div className="flex size-10 items-center justify-center rounded border border-border bg-muted/50 text-muted-foreground">
                            <ImageIcon className="size-5" />
                          </div>
                        )}
                        <div>
                          <Link
                            to="/collections/$id"
                            params={{ id: item.id }}
                            className="font-medium text-foreground hover:underline"
                          >
                            {item.title}
                          </Link>
                          <p className="text-xs font-mono text-muted-foreground">/{item.slug}</p>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      {item.type === "automated" ? (
                        <Badge variant="outline" className="gap-1 border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-400">
                          <Zap className="size-3" />
                          Automated
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 border-border text-muted-foreground">
                          <Boxes className="size-3" />
                          Manual
                        </Badge>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center">
                      <Badge variant="outline" className="font-normal">
                        <Package className="mr-1 size-3 text-muted-foreground" />
                        {item.type === "manual" ? item.productCount ?? 0 : "Dynamic"}
                      </Badge>
                    </td>

                    <td className="py-3 px-4 text-center">
                      {item.published ? (
                        <Badge variant="default" className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Draft
                        </Badge>
                      )}
                    </td>

                    {/* Search engines: Indexed or Hidden column */}
                    <td className="py-3 px-4 text-center">
                      {item.indexable && item.published ? (
                        <Badge variant="default" className="gap-1 bg-sky-500/10 text-sky-700 dark:text-sky-400">
                          <Eye className="size-3" />
                          Indexed
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <EyeOff className="size-3" />
                          Hidden (noindex)
                        </Badge>
                      )}
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
                          <DropdownMenuItem render={<Link to="/collections/$id" params={{ id: item.id }} />}>
                            Edit collection
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateMutation.mutate({ id: item.id, published: !item.published })}
                          >
                            {item.published ? "Unpublish (Draft)" : "Publish (Active)"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateMutation.mutate({ id: item.id, indexable: !item.indexable })}
                          >
                            {item.indexable ? "Disable Search Indexing" : "Enable Search Indexing"}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Collection?"
        description={
          deleteTarget ? (
            <p>
              Are you sure you want to delete collection <strong>{deleteTarget.title}</strong>? Products in this collection will not be deleted.
            </p>
          ) : (
            ""
          )
        }
        confirmLabel="Delete Collection"
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
