import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Download,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Search,
  Trash2,
  Undo2,
  Upload,
  Video as VideoIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  InfoTip,
  Input,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSkeleton,
  Progress,
  SimpleSelect,
  TableSkeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  toast,
} from "@bs/ui";
import {
  MEDIA_ACCEPT_ATTRIBUTE,
  type MediaItem,
  type MediaKind,
} from "@bs/contracts";
import { DataTable, type Column } from "../../../components/data-table/data-table.tsx";
import { BulkBar } from "../../../components/data-table/toolbar-parts.tsx";
import { useTableSelection } from "../../../components/data-table/use-table-selection.ts";
import {
  compactSearch,
  oneOf,
  text,
  useDebouncedValue,
} from "../../../components/data-table/use-table-state.ts";
import { client, orpc } from "../../../lib/orpc.ts";
import { mediaUploadQueue } from "../../../lib/media-upload-queue.ts";
import { MediaUploadTray } from "../../../components/media/media-upload-tray.tsx";
import { MediaDetailSheet } from "../../../components/media/media-detail-sheet.tsx";

const VIEW_STORAGE_KEY = "bs.media.view";

function getStoredView(): "grid" | "table" {
  try {
    const val = localStorage.getItem(VIEW_STORAGE_KEY);
    if (val === "table" || val === "grid") return val;
  } catch {
    // ignore
  }
  return "grid";
}

function setStoredView(val: "grid" | "table") {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, val);
  } catch {
    // ignore
  }
}

type MediaSort = "newest" | "oldest" | "name" | "largest";
type MediaUsageFilter = "any" | "used" | "unused";

const SORT_OPTIONS: Array<{ value: MediaSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "File name (A–Z)" },
  { value: "largest", label: "Size (largest first)" },
];

const USAGE_OPTIONS: Array<{ value: MediaUsageFilter; label: string }> = [
  { value: "any", label: "All usages" },
  { value: "used", label: "Used in store" },
  { value: "unused", label: "Unused" },
];

export interface MediaSearchParams {
  view?: "grid" | "table" | undefined;
  q?: string | undefined;
  kinds?: string | undefined;
  usage?: MediaUsageFilter | undefined;
  sort?: MediaSort | undefined;
  trash?: boolean | undefined;
  selectedId?: string | undefined;
}

export function parseMediaSearch(raw: Record<string, unknown>): MediaSearchParams {
  return {
    view: oneOf(raw["view"], ["grid", "table"] as const),
    q: text(raw["q"]),
    kinds: text(raw["kinds"]),
    usage: oneOf(raw["usage"], ["any", "used", "unused"] as const) ?? "any",
    sort: oneOf(raw["sort"], ["newest", "oldest", "name", "largest"] as const) ?? "newest",
    trash: raw["trash"] === true || raw["trash"] === "true",
    selectedId: text(raw["selectedId"]),
  };
}

export const Route = createFileRoute("/_store/online-store/media")({
  validateSearch: (raw: Record<string, unknown>): MediaSearchParams =>
    compactSearch(parseMediaSearch(raw), {
      usage: "any",
      sort: "newest",
      trash: false,
    }),
  pendingComponent: () => (
    <PageSkeleton>
      <TableSkeleton rows={8} columns={5} />
    </PageSkeleton>
  ),
  component: MediaLibraryPage,
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatRelativeTime(dateStr: string): string {
  const diffSec = Math.round((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function MediaLibraryPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const searchParams = Route.useSearch();
  const queryClient = useQueryClient();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Search state
  const view = searchParams.view || getStoredView();
  const rawQ = searchParams.q || "";
  const [searchInput, setSearchInput] = useDebouncedValue(
    rawQ,
    (val) => {
      navigate({
        search: (prev) => {
          const next = { ...prev };
          if (val.trim()) {
            next.q = val.trim();
          } else {
            delete next.q;
          }
          return next;
        },
        replace: true,
      });
    },
    250,
  );

  const kindsFilter = searchParams.kinds ? (searchParams.kinds.split(",") as MediaKind[]) : undefined;
  const usageFilter = searchParams.usage || "any";
  const sort = searchParams.sort || "newest";
  const isTrash = searchParams.trash === true;
  const selectedMediaId = searchParams.selectedId || null;

  // Drag and drop overlay state
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Bulk actions state
  const [bulkTrashConfirmOpen, setBulkTrashConfirmOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const lastClickedIndexRef = useRef<number | null>(null);

  // Usage stats query
  const usageQuery = useQuery(orpc.admin.media.usage.queryOptions());
  const usageData = usageQuery.data;

  // Media infinite list query
  const mediaQuery = useInfiniteQuery({
    queryKey: [
      "admin",
      "media",
      "list",
      {
        q: rawQ,
        kinds: kindsFilter,
        usage: usageFilter,
        sort,
        trash: isTrash,
      },
    ],
    queryFn: ({ pageParam }) =>
      client.admin.media.list({
        cursor: pageParam ?? undefined,
        limit: 40,
        q: rawQ.trim() || undefined,
        kinds: kindsFilter,
        usage: usageFilter === "any" ? undefined : usageFilter,
        sort,
        trash: isTrash,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // Flatten items
  const items = useMemo(() => {
    return mediaQuery.data?.pages.flatMap((page) => page.items) ?? [];
  }, [mediaQuery.data]);

  const totalCount = mediaQuery.data?.pages[0]?.total ?? 0;

  // Selection state
  const selection = useTableSelection<MediaItem>({
    rows: items,
    getId: (i) => i.id,
    total: totalCount,
    resetKey: `${rawQ}-${searchParams.kinds}-${usageFilter}-${sort}-${isTrash}`,
  });

  // Listen to upload completion to invalidate query
  useEffect(() => {
    return mediaUploadQueue.onUploadSuccess(() => {
      queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
      usageQuery.refetch();
    });
  }, [queryClient, usageQuery]);

  // IntersectionObserver for infinite scrolling sentinel
  useEffect(() => {
    if (!sentinelRef.current || !mediaQuery.hasNextPage || mediaQuery.isFetchingNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && mediaQuery.hasNextPage && !mediaQuery.isFetchingNextPage) {
          mediaQuery.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [mediaQuery.hasNextPage, mediaQuery.isFetchingNextPage, mediaQuery]);

  // Full-page drag-and-drop listeners
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes("Files")) {
        dragCounterRef.current++;
        setIsDraggingOver(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes("Files")) {
        dragCounterRef.current--;
        if (dragCounterRef.current <= 0) {
          dragCounterRef.current = 0;
          setIsDraggingOver(false);
        }
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        mediaUploadQueue.addFiles(files, usageData);
        toast.info(`Queued ${files.length} file${files.length > 1 ? "s" : ""} for upload`);
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [usageData]);

  // View toggle handler
  const handleViewChange = (newView: "grid" | "table") => {
    setStoredView(newView);
    navigate({
      search: (prev) => ({ ...prev, view: newView }),
      replace: true,
    });
  };

  // Tab change handler
  const handleTabChange = (val: string) => {
    selection.clear();
    navigate({
      search: (prev) => ({
        ...prev,
        trash: val === "trash",
      }),
      replace: true,
    });
  };

  // File input change handler
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      mediaUploadQueue.addFiles(files, usageData);
      toast.info(`Queued ${files.length} file${files.length > 1 ? "s" : ""} for upload`);
      e.target.value = "";
    }
  };

  // Item click opens detail sheet
  const handleItemClick = (item: MediaItem) => {
    navigate({
      search: (prev) => ({ ...prev, selectedId: item.id }),
      replace: true,
    });
  };

  const handleCloseDetail = () => {
    navigate({
      search: (prev) => {
        const next = { ...prev };
        delete next.selectedId;
        return next;
      },
      replace: true,
    });
  };

  // Shift-click range selection for grid
  const handleGridItemCheckboxClick = (
    e: React.MouseEvent,
    item: MediaItem,
    currentIndex: number,
  ) => {
    e.stopPropagation();

    if (e.shiftKey && lastClickedIndexRef.current !== null) {
      const start = Math.min(lastClickedIndexRef.current, currentIndex);
      const end = Math.max(lastClickedIndexRef.current, currentIndex);
      const rangeRows = items.slice(start, end + 1);
      selection.togglePage(rangeRows, true);
    } else {
      const isSelected = selection.selectedIds.has(item.id);
      selection.toggleRow(item, !isSelected);
      lastClickedIndexRef.current = currentIndex;
    }
  };

  // Bulk actions mutations
  const bulkTrashMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selection.selectedIds);
      return await client.admin.media.trash({ ids });
    },
    onSuccess: (res) => {
      toast.success(`Moved ${res.trashed} file${res.trashed === 1 ? "" : "s"} to Trash`);
      selection.clear();
      queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
      usageQuery.refetch();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to move files to Trash");
    },
  });

  const bulkRestoreMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selection.selectedIds);
      return await client.admin.media.restore({ ids });
    },
    onSuccess: (res) => {
      toast.success(`Restored ${res.restored} file${res.restored === 1 ? "" : "s"} from Trash`);
      selection.clear();
      queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
      usageQuery.refetch();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to restore files");
    },
  });

  const bulkDeletePermanentMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selection.selectedIds);
      return await client.admin.media.deletePermanent({ ids });
    },
    onSuccess: (res) => {
      if (res.blocked.length > 0) {
        toast.error(
          `${res.blocked.length} file(s) could not be deleted because they are still used in your store.`,
        );
      }
      if (res.deleted > 0) {
        toast.success(`Permanently deleted ${res.deleted} file${res.deleted === 1 ? "" : "s"}`);
      }
      selection.clear();
      queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
      usageQuery.refetch();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete files");
    },
  });

  const handleBulkDownload = () => {
    const selectedItems = items.filter((i) => selection.selectedIds.has(i.id));
    for (const item of selectedItems) {
      if (item.url) {
        const a = document.createElement("a");
        a.href = item.url;
        a.download = item.filename || "media";
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }
  };

  // Storage meter calculation
  const storageLimitBytes = usageData?.limitBytes ?? 0;
  const storageUsedBytes = usageData?.usedBytes ?? 0;
  const storagePercent =
    storageLimitBytes > 0
      ? Math.min(100, Math.round((storageUsedBytes / storageLimitBytes) * 100))
      : 0;

  // Selected items with usage count for warning
  const selectedUsedCount = useMemo(() => {
    return items
      .filter((i) => selection.selectedIds.has(i.id))
      .reduce((acc, curr) => (curr.usageCount > 0 ? acc + 1 : acc), 0);
  }, [items, selection.selectedIds]);

  // Table columns definition
  const tableColumns: Column<MediaItem>[] = useMemo(
    () => [
      {
        id: "thumbnail",
        header: "Preview",
        className: "w-12 text-center",
        cell: (item: MediaItem) => (
          <div className="h-10 w-10 rounded-md border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0">
            {item.kind === "image" ? (
              <img
                src={item.thumbnailUrl || item.url}
                alt={item.alt || ""}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : item.kind === "video" ? (
              <VideoIcon className="h-5 w-5 text-purple-500" />
            ) : (
              <FileText className="h-5 w-5 text-emerald-500" />
            )}
          </div>
        ),
      },
      {
        id: "name",
        header: "Name",
        cell: (item: MediaItem) => (
          <div className="min-w-0">
            <span className="font-medium truncate block text-foreground">
              {item.filename || item.title || "Untitled"}
            </span>
            {Boolean(item.title && item.title !== item.filename) && (
              <span className="text-xs text-muted-foreground truncate block">{item.title}</span>
            )}
          </div>
        ),
      },
      {
        id: "kind",
        header: "Type",
        cell: (item: MediaItem) => (
          <Badge variant="outline" className="capitalize text-xs">
            {item.kind}
          </Badge>
        ),
      },
      {
        id: "dimensions",
        header: "Dimensions / Duration",
        cell: (item: MediaItem) => {
          if (item.width && item.height) {
            return (
              <span className="text-xs font-mono text-muted-foreground">
                {item.width} × {item.height}
              </span>
            );
          }
          if (item.durationMs) {
            return (
              <span className="text-xs font-mono text-muted-foreground">
                {formatDuration(item.durationMs)}
              </span>
            );
          }
          return <span className="text-muted-foreground">—</span>;
        },
      },
      {
        id: "size",
        header: "Size",
        cell: (item: MediaItem) => (
          <span className="text-xs font-mono text-muted-foreground">{formatBytes(item.bytes)}</span>
        ),
      },
      {
        id: "usage",
        header: "Used in",
        cell: (item: MediaItem) => {
          if (item.usageCount > 0) {
            return (
              <Badge
                variant="secondary"
                className="cursor-pointer hover:bg-secondary/80 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  handleItemClick(item);
                }}
              >
                Used in {item.usageCount}
              </Badge>
            );
          }
          return <span className="text-xs text-muted-foreground">Unused</span>;
        },
      },
      {
        id: "uploaded",
        header: "Uploaded",
        cell: (item: MediaItem) => (
          <span
            className="text-xs text-muted-foreground"
            title={new Date(item.createdAt).toLocaleString()}
          >
            {formatRelativeTime(item.createdAt)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <PageContainer>
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Online Store", href: "/online-store/pages" },
          { label: "Media" },
        ]}
      />

      <PageHeader
        title="Media"
        description="Upload and organize images, videos, and documents for your store."
        aside={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Storage Meter */}
            {Boolean(usageData) && (
              <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs">
                <div className="space-y-1 min-w-[130px] sm:min-w-[160px]">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Storage</span>
                    <span className="font-mono">
                      {formatBytes(storageUsedBytes)} / {formatBytes(storageLimitBytes)}
                    </span>
                  </div>
                  <Progress
                    value={storagePercent}
                    className={cn(
                      "h-1.5",
                      storagePercent >= 95
                        ? "[&>div]:bg-destructive"
                        : storagePercent >= 80
                          ? "[&>div]:bg-amber-500"
                          : "[&>div]:bg-primary",
                    )}
                  />
                </div>
                <InfoTip>
                  <div className="space-y-1 text-xs">
                    <p className="font-semibold">Plan Upload Limits</p>
                    <p>
                      Images: up to{" "}
                      {formatBytes(usageData?.limits.image ?? 5 * 1024 * 1024)}
                    </p>
                    <p>
                      Videos: up to{" "}
                      {formatBytes(usageData?.limits.video ?? 10 * 1024 * 1024)}
                    </p>
                    <p>
                      Documents: up to{" "}
                      {formatBytes(usageData?.limits.document ?? 5 * 1024 * 1024)}
                    </p>
                  </div>
                </InfoTip>
              </div>
            )}

            <Button
              onClick={() => fileInputRef.current?.click()}
              className="gap-2 shrink-0"
            >
              <Upload className="h-4 w-4" />
              Upload files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={MEDIA_ACCEPT_ATTRIBUTE}
              className="hidden"
              onChange={handleFileInputChange}
            />
          </div>
        }
      />

      {/* Tabs */}
      <Tabs value={isTrash ? "trash" : "all"} onValueChange={handleTabChange} className="w-full">
        <TabsList>
          <TabsTrigger value="all">All files</TabsTrigger>
          <TabsTrigger value="trash" className="gap-1.5">
            <Trash2 className="h-3.5 w-3.5" />
            Trash
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search filename or title..."
              className="pl-8 h-9 text-xs"
            />
          </div>

          {/* Type Filter Buttons */}
          <div className="flex items-center gap-1 border rounded-md p-0.5 bg-muted/40">
            <Button
              variant={!kindsFilter ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() =>
                navigate({
                  search: (prev) => {
                    const next = { ...prev };
                    delete next.kinds;
                    return next;
                  },
                  replace: true,
                })
              }
            >
              All types
            </Button>
            <Button
              variant={kindsFilter?.includes("image") && kindsFilter.length === 1 ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2 gap-1"
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, kinds: "image" }),
                  replace: true,
                })
              }
            >
              <ImageIcon className="h-3 w-3" />
              Images
            </Button>
            <Button
              variant={kindsFilter?.includes("video") && kindsFilter.length === 1 ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2 gap-1"
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, kinds: "video" }),
                  replace: true,
                })
              }
            >
              <VideoIcon className="h-3 w-3" />
              Videos
            </Button>
            <Button
              variant={kindsFilter?.includes("document") && kindsFilter.length === 1 ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2 gap-1"
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, kinds: "document" }),
                  replace: true,
                })
              }
            >
              <FileText className="h-3 w-3" />
              Docs
            </Button>
          </div>

          {/* Usage Filter */}
          {!isTrash && (
            <div className="w-36">
              <SimpleSelect
                value={usageFilter}
                onChange={(val) =>
                  navigate({
                    search: (prev) => ({ ...prev, usage: val as MediaUsageFilter }),
                    replace: true,
                  })
                }
                options={USAGE_OPTIONS}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2">
          {/* Sort */}
          <div className="w-44">
            <SimpleSelect
              value={sort}
              onChange={(val) =>
                navigate({
                  search: (prev) => ({ ...prev, sort: val as MediaSort }),
                  replace: true,
                })
              }
              options={SORT_OPTIONS}
            />
          </div>

          {/* View Toggle */}
          <div className="flex items-center rounded-md border p-0.5 bg-muted/40">
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => handleViewChange("grid")}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => handleViewChange("table")}
              aria-label="Table view"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {mediaQuery.isLoading ? (
        view === "grid" ? (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 gap-3 sm:gap-4 mt-2">
            {Array.from({ length: 16 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg border bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : (
          <TableSkeleton rows={8} columns={6} />
        )
      ) : items.length === 0 ? (
        <EmptyState
          title={isTrash ? "Trash is empty" : "No media files found"}
          description={
            isTrash
              ? "Files moved to Trash will appear here and are automatically cleaned up after 30 days."
              : rawQ || kindsFilter || usageFilter !== "any"
                ? "No files matched your search or active filters. Try adjusting your search criteria."
                : "Upload product photos, videos, and documents to get started. You can also drag and drop files anywhere on this page."
          }
          action={
            !isTrash ? (
              <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
                <Upload className="h-4 w-4" />
                Upload files
              </Button>
            ) : undefined
          }
        />
      ) : view === "grid" ? (
        /* Grid View */
        <div
          role="grid"
          aria-label="Media library grid"
          className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 gap-3 sm:gap-4 mt-2"
        >
          {items.map((item, idx) => {
            const isSelected = selection.selectedIds.has(item.id);
            const ext = (item.filename || "").split(".").pop() || "";

            return (
              <div
                key={item.id}
                role="gridcell"
                tabIndex={0}
                onClick={() => handleItemClick(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleItemClick(item);
                  if (e.key === " ") {
                    e.preventDefault();
                    selection.toggleRow(item, !isSelected);
                  }
                }}
                className={cn(
                  "group relative aspect-square rounded-lg border bg-card text-card-foreground overflow-hidden cursor-pointer flex flex-col justify-between transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isSelected
                    ? "ring-2 ring-primary border-primary bg-primary/5"
                    : "hover:border-primary/50 hover:shadow-sm",
                )}
              >
                {/* Checkbox Overlay */}
                <div
                  className={cn(
                    "absolute top-2 left-2 z-10 transition-opacity",
                    isSelected || selection.selectedIds.size > 0
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
                  )}
                  onClick={(e) => handleGridItemCheckboxClick(e, item, idx)}
                >
                  <Checkbox
                    checked={isSelected}
                    aria-label={`Select ${item.filename || "file"}`}
                    className="h-4 w-4 bg-background/90 shadow-sm"
                  />
                </div>

                {/* Thumbnail Display */}
                <div className="relative w-full h-[calc(100%-2.25rem)] overflow-hidden bg-muted/30 flex items-center justify-center">
                  {item.kind === "image" ? (
                    <img
                      src={item.thumbnailUrl || item.url}
                      alt={item.alt || item.filename || ""}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : item.kind === "video" ? (
                    <div className="relative w-full h-full flex items-center justify-center bg-black/5 dark:bg-black/30">
                      <VideoIcon className="h-10 w-10 text-purple-500 opacity-80" />
                      {Boolean(item.durationMs) && (
                        <span className="absolute bottom-1.5 right-1.5 font-mono text-[10px] bg-black/75 text-white px-1 py-0.5 rounded">
                          {formatDuration(item.durationMs)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center p-2 text-center">
                      <FileText className="h-10 w-10 text-emerald-500 mb-1" />
                      <span className="font-mono text-[10px] font-bold uppercase text-muted-foreground">
                        {ext}
                      </span>
                    </div>
                  )}

                  {/* Usage indicator badge */}
                  {item.usageCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="absolute top-2 right-2 text-[10px] px-1 py-0 bg-background/90 shadow-xs"
                    >
                      Used ({item.usageCount})
                    </Badge>
                  )}
                </div>

                {/* Footer Subtitle */}
                <div className="px-2 py-1 bg-card border-t text-[11px] flex items-center justify-between gap-1 min-w-0">
                  <span className="truncate font-medium text-foreground" title={item.filename || ""}>
                    {item.filename || "Untitled"}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                    {formatBytes(item.bytes)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="rounded-lg border bg-card mt-2">
          <DataTable<MediaItem>
            rows={items}
            columns={tableColumns}
            getRowId={(item) => item.id}
            selectedIds={selection.selectedIds}
            onToggleRow={selection.toggleRow}
            onTogglePage={selection.togglePage}
            onRowClick={(item) => handleItemClick(item)}
            empty={
              <div className="p-8 text-center text-sm text-muted-foreground">
                No media files found
              </div>
            }
          />
        </div>
      )}

      {/* Infinite Scroll Sentinel */}
      {mediaQuery.hasNextPage && (
        <div ref={sentinelRef} className="py-6 flex flex-col items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => mediaQuery.fetchNextPage()}
            disabled={mediaQuery.isFetchingNextPage}
          >
            {mediaQuery.isFetchingNextPage ? "Loading more files..." : "Load more"}
          </Button>
        </div>
      )}

      {/* Bulk Action Bar */}
      <BulkBar
        count={selection.count}
        noun="file"
        total={totalCount}
        allResults={selection.allResults}
        pageFullySelected={selection.pageFullySelected}
        onSelectAllResults={selection.selectAllResults}
        onClear={selection.clear}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={handleBulkDownload}
          className="gap-1.5 h-8 text-xs"
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>

        {!isTrash ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setBulkTrashConfirmOpen(true)}
            className="gap-1.5 h-8 text-xs"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Move to Trash
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => bulkRestoreMutation.mutate()}
              disabled={bulkRestoreMutation.isPending}
              className="gap-1.5 h-8 text-xs"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Restore
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteConfirmOpen(true)}
              className="gap-1.5 h-8 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete permanently
            </Button>
          </>
        )}
      </BulkBar>

      {/* Confirmation Dialogs for Bulk Operations */}
      <ConfirmDialog
        open={bulkTrashConfirmOpen}
        onOpenChange={setBulkTrashConfirmOpen}
        title={`Move ${selection.selectedIds.size} files to Trash?`}
        description={
          selectedUsedCount > 0 ? (
            <div className="space-y-2">
              <p className="text-amber-600 dark:text-amber-400 font-medium">
                {selectedUsedCount} of the selected files are currently used in your catalog.
              </p>
              <p>
                They will continue to be shown on your storefront until removed from products or
                collections.
              </p>
            </div>
          ) : (
            "Files in Trash can be restored within 30 days before being automatically cleaned up."
          )
        }
        confirmLabel="Move to Trash"
        destructive
        onConfirm={() => bulkTrashMutation.mutate()}
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={setBulkDeleteConfirmOpen}
        title={`Permanently delete ${selection.selectedIds.size} files?`}
        description="Permanently deletes the selected files and removes their storage objects. This cannot be undone. Any files still used in your store will be protected and refused."
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => bulkDeletePermanentMutation.mutate()}
      />

      {/* Detail Sheet */}
      <MediaDetailSheet
        mediaId={selectedMediaId}
        onClose={handleCloseDetail}
        onItemTrashed={() => {
          queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
          usageQuery.refetch();
        }}
        onItemRestored={() => {
          queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
          usageQuery.refetch();
        }}
        onItemDeleted={() => {
          queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
          usageQuery.refetch();
        }}
      />

      {/* Floating Upload Tray */}
      <MediaUploadTray />

      {/* Full-Page Drag-and-Drop Overlay */}
      {isDraggingOver && (
        <div
          role="region"
          aria-live="polite"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/85 backdrop-blur-sm border-4 border-dashed border-primary transition-all pointer-events-none"
        >
          <div className="flex flex-col items-center justify-center gap-3 p-8 rounded-xl bg-card border shadow-2xl text-center max-w-md">
            <Upload className="h-16 w-16 text-primary animate-bounce" />
            <h3 className="text-xl font-bold text-foreground">Drop files to upload</h3>
            <p className="text-sm text-muted-foreground">
              Release files here to immediately queue them into your store media library.
            </p>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
