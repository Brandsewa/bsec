import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2,
  Clock,
  MessageSquare,
  MoreHorizontal,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  MetricCard,
  MetricCardSkeleton,
  PageContainer,
  PageHeader,
  PageSkeleton,
  toast,
} from "@bs/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Review } from "@bs/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { ScrollTabs } from "../../components/scroll-tabs.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

type ReviewStatusFilter = "all" | "published" | "on_hold" | "replied" | "awaiting_reply";

const STATUS_TABS: ReadonlyArray<{ id: ReviewStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "published", label: "Published" },
  { id: "on_hold", label: "On Hold" },
  { id: "replied", label: "Replied" },
  { id: "awaiting_reply", label: "Awaiting Reply" },
];

export interface ReviewsSearch {
  status?: ReviewStatusFilter | undefined;
  q?: string | undefined;
  rating?: number | undefined;
  page?: number | undefined;
}

export const Route = createFileRoute("/_store/reviews")({
  validateSearch: (raw: Record<string, unknown>): ReviewsSearch => ({
    status: (["all", "published", "on_hold", "replied", "awaiting_reply"] as const).includes(
      raw["status"] as ReviewStatusFilter,
    )
      ? (raw["status"] as ReviewStatusFilter)
      : "all",
    q: typeof raw["q"] === "string" ? raw["q"] : undefined,
    rating: typeof raw["rating"] === "number" || (typeof raw["rating"] === "string" && !isNaN(Number(raw["rating"])))
      ? Number(raw["rating"])
      : undefined,
    page: typeof raw["page"] === "number" || (typeof raw["page"] === "string" && !isNaN(Number(raw["page"])))
      ? Number(raw["page"])
      : 1,
  }),
  pendingComponent: () => <PageSkeleton />,
  component: ReviewsPage,
});

export function ReviewsPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const queryClient = useQueryClient();

  const status = search.status ?? "all";
  const [queryText, setQueryText] = useState(search.q ?? "");
  const [selectedRating, setSelectedRating] = useState<number | undefined>(search.rating);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Review | null>(null);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<Review | null>(null);
  const [replyText, setReplyText] = useState("");

  const page = search.page ?? 1;
  const pageSize = 20;

  const statsQuery = useQuery(orpc.admin.reviews.stats.queryOptions());

  const listQuery = useQuery(
    orpc.admin.reviews.list.queryOptions({
      input: {
        status,
        search: search.q,
        rating: search.rating,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      },
      placeholderData: keepPreviousData,
    }),
  );

  const publishMutation = useMutation(
    orpc.admin.reviews.publish.mutationOptions({
      onSuccess: () => {
        toast.success("Review published");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.stats.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  const holdMutation = useMutation(
    orpc.admin.reviews.hold.mutationOptions({
      onSuccess: () => {
        toast.success("Review put on hold");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.stats.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  const deleteMutation = useMutation(
    orpc.admin.reviews.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Review deleted");
        setDeleteTarget(null);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.stats.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  const replyMutation = useMutation(
    orpc.admin.reviews.reply.mutationOptions({
      onSuccess: () => {
        toast.success("Reply saved");
        setReplyTarget(null);
        setReplyText("");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.stats.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  const bulkPublishMutation = useMutation(
    orpc.admin.reviews.bulkPublish.mutationOptions({
      onSuccess: (res: { count: number }) => {
        toast.success(`Published ${res.count} reviews`);
        setSelectedIds([]);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.stats.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  const bulkHoldMutation = useMutation(
    orpc.admin.reviews.bulkHold.mutationOptions({
      onSuccess: (res: { count: number }) => {
        toast.success(`Put ${res.count} reviews on hold`);
        setSelectedIds([]);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.stats.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  const bulkDeleteMutation = useMutation(
    orpc.admin.reviews.bulkDelete.mutationOptions({
      onSuccess: (res: { count: number }) => {
        toast.success(`Deleted ${res.count} reviews`);
        setSelectedIds([]);
        setIsBulkDeleteOpen(false);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.reviews.stats.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  const updateSearch = (next: Partial<ReviewsSearch>) => {
    void navigate({
      to: ".",
      replace: true,
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        status: next.status !== undefined ? next.status : search.status,
        q: next.q !== undefined ? next.q : search.q,
        rating: next.rating !== undefined ? next.rating : search.rating,
        page: next.page !== undefined ? next.page : 1,
      })) as never,
    });
  };

  const handleTabChange = (nextStatus: string) => {
    updateSearch({ status: nextStatus as ReviewStatusFilter, page: 1 });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSearch({ q: queryText.trim() || undefined, page: 1 });
  };

  const handleRatingFilter = (r: number | undefined) => {
    setSelectedRating(r);
    updateSearch({ rating: r, page: 1 });
  };

  const reviews = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const stats = statsQuery.data;

  const allSelected = reviews.length > 0 && selectedIds.length === reviews.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < reviews.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(reviews.map((r: Review) => r.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  return (
    <PageContainer size="default">
      <PageHeader
        title="Customer Reviews"
        description="Moderate, manage, and reply to customer product feedback."
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statsQuery.isLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : stats ? (
          <>
            <MetricCard
              label="Average Rating"
              value={stats.averageRating > 0 ? `${stats.averageRating.toFixed(1)} / 5.0` : "—"}
            />
            <MetricCard
              label="Published"
              value={stats.published}
            />
            <MetricCard
              label="On Hold"
              value={stats.onHold}
            />
            <MetricCard
              label="Awaiting Reply"
              value={stats.awaitingReply}
            />
          </>
        ) : null}
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col gap-4">
        <ScrollTabs
          tabs={STATUS_TABS}
          value={status}
          onChange={handleTabChange}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by reviewer, title, content..."
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              className="pl-9"
            />
          </form>

          {/* Rating filter */}
          <div className="flex items-center gap-1">
            <Button
              variant={selectedRating === undefined ? "secondary" : "outline"}
              size="sm"
              onClick={() => handleRatingFilter(undefined)}
            >
              All Stars
            </Button>
            {[5, 4, 3, 2, 1].map((star) => (
              <Button
                key={star}
                variant={selectedRating === star ? "secondary" : "outline"}
                size="sm"
                onClick={() => handleRatingFilter(selectedRating === star ? undefined : star)}
                className="gap-1"
              >
                {star} <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              </Button>
            ))}
          </div>
        </div>

        {/* Bulk action banner */}
        {selectedIds.length > 0 && (
          <div className="flex items-center justify-between rounded-lg border bg-muted/60 px-4 py-2 text-sm">
            <span>
              <strong>{selectedIds.length}</strong> {selectedIds.length === 1 ? "review" : "reviews"} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulkPublishMutation.mutate({ ids: selectedIds })}
                disabled={bulkPublishMutation.isPending}
              >
                Publish Selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulkHoldMutation.mutate({ ids: selectedIds })}
                disabled={bulkHoldMutation.isPending}
              >
                Put On Hold
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setIsBulkDeleteOpen(true)}
              >
                Delete Selected
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Reviews Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(input) => {
                      if (input) input.indeterminate = someSelected;
                    }}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Rating & Review</th>
                <th className="px-4 py-3">Reviewer</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="w-12 px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {listQuery.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    Loading reviews...
                  </td>
                </tr>
              ) : reviews.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    No reviews found matching this filter.
                  </td>
                </tr>
              ) : (
                reviews.map((review: Review) => {
                  const isSelected = selectedIds.includes(review.id);
                  return (
                    <tr
                      key={review.id}
                      className={`hover:bg-muted/30 transition-colors ${
                        isSelected ? "bg-muted/20" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(review.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {review.productTitle ? (
                          <div className="flex flex-col">
                            <span className="font-semibold line-clamp-1">{review.productTitle}</span>
                            {review.productSlug && (
                              <span className="text-xs text-muted-foreground font-mono">
                                /{review.productSlug}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Product #{review.productId.slice(0, 8)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-md">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                className={`h-3.5 w-3.5 ${
                                  i < review.rating
                                    ? "fill-amber-400 text-amber-400"
                                    : "text-muted-foreground/30"
                                }`}
                              />
                            ))}
                            {review.title && (
                              <span className="ml-1.5 font-semibold text-xs text-foreground">
                                {review.title}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{review.body}</p>
                          {review.replyText && (
                            <div className="mt-1 rounded bg-muted/50 p-2 text-xs border-l-2 border-primary">
                              <span className="font-semibold text-foreground">Store Reply: </span>
                              <span className="text-muted-foreground">{review.replyText}</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{review.reviewerName}</span>
                          {review.isVerifiedPurchase && (
                            <Badge variant="outline" className="mt-1 w-fit text-[10px] text-emerald-600 border-emerald-300 bg-emerald-50">
                              Verified Purchase
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(review.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {review.status === "published" ? (
                          <Badge className="bg-emerald-600 hover:bg-emerald-700">Published</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                            On Hold
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-8 w-8" />}>
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {review.status === "on_hold" ? (
                              <DropdownMenuItem
                                onClick={() => publishMutation.mutate({ id: review.id })}
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" />
                                Publish
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => holdMutation.mutate({ id: review.id })}
                              >
                                <Clock className="mr-2 h-4 w-4 text-amber-600" />
                                Put On Hold
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => {
                                setReplyTarget(review);
                                setReplyText(review.replyText ?? "");
                              }}
                            >
                              <MessageSquare className="mr-2 h-4 w-4" />
                              {review.replyText ? "Edit Reply" : "Reply"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteTarget(review)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-xs text-muted-foreground">
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} reviews
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => updateSearch({ page: page - 1 })}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page * pageSize >= total}
                onClick={() => updateSearch({ page: page + 1 })}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Reply Dialog */}
      <Dialog open={!!replyTarget} onOpenChange={(open) => !open && setReplyTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reply to Review</DialogTitle>
            <DialogDescription>
              Your public response will be displayed directly below the customer's review on the storefront.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {replyTarget && (
              <div className="rounded-md bg-muted p-3 text-xs">
                <div className="font-semibold text-foreground">{replyTarget.reviewerName} ({replyTarget.rating}★)</div>
                {replyTarget.title && <div className="font-medium text-foreground">{replyTarget.title}</div>}
                <div className="text-muted-foreground mt-1">{replyTarget.body}</div>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold">Store Response (max 1000 characters)</label>
              <Textarea
                placeholder="Thank the customer or address their feedback..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value.slice(0, 1000))}
                rows={4}
              />
              <span className="text-[11px] text-muted-foreground block text-right">
                {replyText.length}/1000
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (replyTarget) {
                  replyMutation.mutate({ id: replyTarget.id, replyText: replyText.trim() });
                }
              }}
              disabled={replyMutation.isPending || !replyText.trim()}
            >
              Save Reply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Single Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Review"
        description="Are you sure you want to delete this customer review? This will update the product rating aggregates."
        confirmLabel="Delete Review"
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ id: deleteTarget.id });
          }
        }}
      />

      {/* Bulk Delete Confirm */}
      <ConfirmDialog
        open={isBulkDeleteOpen}
        onOpenChange={setIsBulkDeleteOpen}
        title={`Delete ${selectedIds.length} Reviews`}
        description="Are you sure you want to delete all selected reviews? Product rating averages will be recalculated."
        confirmLabel={`Delete ${selectedIds.length} Reviews`}
        destructive
        onConfirm={() => {
          bulkDeleteMutation.mutate({ ids: selectedIds });
        }}
      />
    </PageContainer>
  );
}
