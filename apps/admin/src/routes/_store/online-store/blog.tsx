import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FileText, FolderTree, MoreHorizontal, Plus, Settings2, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FieldLabel,
  InfoTip,
  Input,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  ScrollTabs,
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
import type { BlogPostListItem, BlogSettings } from "@bs/contracts";
import { TableToolbar } from "../../../components/data-table/table-toolbar.tsx";
import { errorMessage } from "../../../lib/errors.ts";
import { orpc } from "../../../lib/orpc.ts";

type StatusFilter = "all" | "published" | "scheduled" | "draft";
const STATUS_TABS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "published", label: "Published" },
  { id: "scheduled", label: "Scheduled" },
  { id: "draft", label: "Drafts" },
];
const PAGE_SIZE = 25;

export interface BlogListSearch {
  status?: StatusFilter | undefined;
  q?: string | undefined;
  category?: string | undefined;
  page?: number | undefined;
}

export const Route = createFileRoute("/_store/online-store/blog")({
  validateSearch: (raw: Record<string, unknown>): BlogListSearch => ({
    status: (["all", "published", "scheduled", "draft"] as const).includes(raw["status"] as StatusFilter) ? (raw["status"] as StatusFilter) : "all",
    q: typeof raw["q"] === "string" ? raw["q"] : undefined,
    category: typeof raw["category"] === "string" ? raw["category"] : undefined,
    page: typeof raw["page"] === "number" && raw["page"] > 1 ? Math.trunc(raw["page"]) : undefined,
  }),
  pendingComponent: () => <PageSkeleton />,
  component: BlogPostsPage,
});

function statusBadge(item: BlogPostListItem) {
  if (item.status === "published") return <Badge variant="default" className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">Published</Badge>;
  if (item.status === "scheduled") return <Badge variant="outline" className="text-sky-700 dark:text-sky-400">Scheduled</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Draft</Badge>;
}

function BlogPostsPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const status = search.status ?? "all";
  const page = search.page ?? 1;
  const [queryText, setQueryText] = useState(search.q ?? "");
  const [deleteTarget, setDeleteTarget] = useState<BlogPostListItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const categories = useQuery(orpc.admin.blog.categories.list.queryOptions());
  const list = useQuery({
    ...orpc.admin.blog.posts.list.queryOptions({
      input: {
        status: status === "all" ? undefined : status,
        search: search.q?.trim() || undefined,
        categoryId: search.category || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
    }),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.blog.posts.list.key() });
  const onError = (fallback: string) => (err: unknown) => toast.error(errorMessage(err, fallback));
  const publish = useMutation(orpc.admin.blog.posts.publish.mutationOptions({ onSuccess: () => { toast.success("Post published"); refresh(); }, onError: onError("Could not publish") }));
  // The star marks a post as featured: featured posts fill the "Featured posts" card on the blog post page.
  const feature = useMutation(orpc.admin.blog.posts.update.mutationOptions({ onSuccess: refresh, onError: onError("Could not change the featured star") }));
  const unpublish = useMutation(orpc.admin.blog.posts.unpublish.mutationOptions({ onSuccess: () => { toast.success("Post moved to drafts"); refresh(); }, onError: onError("Could not unpublish") }));
  const duplicate = useMutation(
    orpc.admin.blog.posts.duplicate.mutationOptions({
      onSuccess: (res) => {
        toast.success("Post duplicated as a draft");
        refresh();
        void navigate({ to: "/online-store/blog/$id", params: { id: res.id } });
      },
      onError: onError("Could not duplicate"),
    }),
  );
  const remove = useMutation(
    orpc.admin.blog.posts.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Post deleted");
        setDeleteTarget(null);
        refresh();
      },
      onError: onError("Could not delete the post"),
    }),
  );

  const setSearch = (patch: Partial<BlogListSearch>) =>
    void navigate({ to: ".", replace: true, search: ((prev: Record<string, unknown>) => ({ ...prev, page: undefined, ...patch })) as never });

  const categoryOptions = [{ value: "", label: "All categories" }].concat(
    (categories.data ?? []).flatMap((c) => [{ value: c.id, label: c.name }, ...(c.children ?? []).map((k) => ({ value: k.id, label: `${c.name} › ${k.name}` }))]),
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title="Blog"
        description="Write posts, group them in categories and publish them on your store's blog."
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="mr-1.5 size-4" aria-hidden />
              Blog settings
            </Button>
            <Button variant="outline" size="sm" render={<Link to="/online-store/blog/categories" />} nativeButton={false}>
              <FolderTree className="mr-1.5 size-4" aria-hidden />
              Categories
            </Button>
            <Button render={<Link to="/online-store/blog/new" />} nativeButton={false}>
              <Plus className="mr-1.5 size-4" aria-hidden />
              Add post
            </Button>
          </div>
        }
      />

      <PageSection>
        <div className="grid gap-3">
          <ScrollTabs tabs={STATUS_TABS.map((t) => ({ ...t, count: list.data?.counts[t.id] }))} value={status} onChange={(val) => setSearch({ status: val as StatusFilter })} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[240px] flex-1">
              <TableToolbar
                searchLabel="Search posts"
                searchPlaceholder="Search posts..."
                searchText={queryText}
                onSearchText={(v) => {
                  setQueryText(v);
                  setSearch({ q: v.trim() || undefined });
                }}
                resultCount={total}
                noun="posts"
              />
            </div>
            <div className="w-56">
              <SimpleSelect ariaLabel="Filter by category" value={search.category ?? ""} onChange={(v) => setSearch({ category: v || undefined })} options={categoryOptions} placeholder="All categories" />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl bg-card shadow-xs">
            {list.isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading posts...</div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center">
                <FileText className="size-10 text-muted-foreground/60" aria-hidden />
                <h3 className="mt-4 text-base font-medium">{search.q || search.category || status !== "all" ? "No posts match" : "No posts yet"}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{search.q || search.category || status !== "all" ? "Try another filter." : "Write your first post to start your blog."}</p>
                {!search.q && !search.category && status === "all" && (
                  <Button render={<Link to="/online-store/blog/new" />} nativeButton={false} size="sm" className="mt-4">
                    <Plus className="mr-1.5 size-4" aria-hidden />
                    Add post
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/60 text-xs font-medium text-muted-foreground">
                    <tr>
                      <th className="py-3 pr-4 pl-6">Post</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Author</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="py-3 pr-6 pl-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {items.map((item) => (
                      <tr key={item.id} className="transition-colors hover:bg-muted/40">
                        <td className="py-3 pr-4 pl-6">
                          <div className="flex items-center gap-3">
                            {item.featuredImageUrl ? (
                              <img src={item.featuredImageUrl} alt="" className="size-10 shrink-0 rounded object-cover" loading="lazy" />
                            ) : (
                              <div className="flex size-10 shrink-0 items-center justify-center rounded bg-muted/60 text-muted-foreground">
                                <FileText className="size-4" aria-hidden />
                              </div>
                            )}
                            <button
                              type="button"
                              aria-pressed={item.isFeatured}
                              aria-label={item.isFeatured ? `Remove ${item.title} from featured posts` : `Feature ${item.title}`}
                              title={item.isFeatured ? "Featured: click to remove" : "Click to feature this post"}
                              disabled={feature.isPending}
                              onClick={() => feature.mutate({ id: item.id, isFeatured: !item.isFeatured })}
                              className="shrink-0 rounded p-1 hover:bg-muted"
                            >
                              <Star className={`size-4 ${item.isFeatured ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50"}`} aria-hidden />
                            </button>
                            <div className="min-w-0">
                              <Link to="/online-store/blog/$id" params={{ id: item.id }} className="font-medium text-foreground hover:underline">
                                {item.title}
                              </Link>
                              <p className="truncate font-mono text-xs text-muted-foreground">/blog/{item.slug}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{item.categoryName ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{item.authorName || "—"}</td>
                        <td className="px-4 py-3 text-center">{statusBadge(item)}</td>
                        <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                          {new Date(item.status === "draft" ? item.updatedAt : (item.publishedAt ?? item.updatedAt)).toLocaleDateString()}
                        </td>
                        <td className="py-3 pr-6 pl-4 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button variant="ghost" size="sm" className="size-8 p-0" aria-label={`Actions for ${item.title}`}>
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem render={<Link to="/online-store/blog/$id" params={{ id: item.id }} />}>Edit</DropdownMenuItem>
                              {item.status === "published" ? (
                                <DropdownMenuItem onClick={() => unpublish.mutate({ id: item.id })}>Move to drafts</DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => publish.mutate({ id: item.id })}>Publish now</DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => duplicate.mutate({ id: item.id })}>Duplicate</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(item)}>
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

          {pages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => void navigate({ to: ".", search: ((prev: Record<string, unknown>) => ({ ...prev, page: page - 1 })) as never })}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => void navigate({ to: ".", search: ((prev: Record<string, unknown>) => ({ ...prev, page: page + 1 })) as never })}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </PageSection>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this post?"
        description={deleteTarget ? <p>This permanently deletes <strong>{deleteTarget.title}</strong>. Its address will no longer work.</p> : ""}
        confirmLabel="Delete post"
        destructive
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate({ id: deleteTarget.id })}
      />
      <BlogSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </PageContainer>
  );
}

function BlogSettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const settings = useQuery({ ...orpc.admin.blog.settings.get.queryOptions(), enabled: open });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[40%]">
        <SheetHeader>
          <SheetTitle>Blog settings</SheetTitle>
          <SheetDescription>Turn the blog on or off and set how the blog page is introduced.</SheetDescription>
        </SheetHeader>
        {settings.data ? <BlogSettingsForm key={JSON.stringify(settings.data)} initial={settings.data} onDone={() => onOpenChange(false)} /> : <div className="p-6 text-sm text-muted-foreground">Loading...</div>}
      </SheetContent>
    </Sheet>
  );
}

function BlogSettingsForm({ initial, onDone }: { initial: BlogSettings; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [s, setS] = useState(initial);
  const save = useMutation(
    orpc.admin.blog.settings.update.mutationOptions({
      onSuccess: () => {
        toast.success("Blog settings saved");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.blog.settings.get.key() });
        onDone();
      },
      onError: (err) => toast.error(errorMessage(err, "Could not save settings")),
    }),
  );
  return (
    <>
      <div className="grid gap-5 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <FieldLabel htmlFor="blog-enabled">Blog is on</FieldLabel>
            <InfoTip>When off, the blog pages show not found and posts are left out of the sitemap and the recent posts section.</InfoTip>
          </div>
          <Switch id="blog-enabled" checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} />
        </div>
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="blog-title">Blog title</FieldLabel>
          <Input id="blog-title" value={s.title} maxLength={120} onChange={(e) => setS({ ...s, title: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="blog-description">Description for search engines</FieldLabel>
          <Textarea id="blog-description" rows={3} maxLength={320} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="blog-per-page">Posts per page</FieldLabel>
          <Input id="blog-per-page" type="number" min={3} max={48} value={s.postsPerPage} onChange={(e) => setS({ ...s, postsPerPage: Math.min(48, Math.max(3, Number(e.target.value) || 9)) })} />
        </div>
      </div>
      <SheetFooter className="px-6 pb-6">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button onClick={() => save.mutate(s)} disabled={save.isPending}>{save.isPending ? "Saving..." : "Save settings"}</Button>
      </SheetFooter>
    </>
  );
}
