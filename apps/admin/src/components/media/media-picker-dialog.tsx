import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Check,
  AlertCircle,
  RotateCw,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  toast,
} from "@bs/ui";
import {
  ALLOWED_MEDIA_TYPES,
  MEDIA_ACCEPT_ATTRIBUTE,
  type MediaItem,
  type MediaKind,
} from "@bs/contracts";
import { orpc } from "../../lib/orpc.ts";
import {
  mediaUploadQueue,
  type UploadQueueItem,
} from "../../lib/media-upload-queue.ts";
import { formatBytes } from "./format.ts";
import { MediaTile } from "./media-tile.tsx";
import {
  MediaFiltersBar,
  type MediaSort,
  type MediaUsageFilter,
} from "./media-filters-bar.tsx";
import { useMediaList } from "./use-media-list.ts";

export interface MediaPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accept?: MediaKind[] | undefined;
  multiple?: boolean | undefined;
  max?: number | undefined;
  selected?: MediaItem[] | string[] | undefined;
  onSelect: (items: MediaItem[]) => void;
  title?: string | undefined;
}

export function MediaPickerDialog(props: MediaPickerDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <MediaPickerDialogInner {...props} />}
    </Dialog>
  );
}

function MediaPickerDialogInner({
  onOpenChange,
  accept,
  multiple = false,
  max,
  selected = [],
  onSelect,
  title = "Select media",
}: MediaPickerDialogProps) {
  const initialIds: string[] = [];
  const initialItems: MediaItem[] = [];
  for (const item of selected) {
    if (typeof item === "string") {
      initialIds.push(item);
    } else if (item && item.id) {
      initialIds.push(item.id);
      initialItems.push(item);
    }
  }

  const [activeTab, setActiveTab] = useState<"library" | "upload">("library");
  const [q, setQ] = useState("");
  const [kinds, setKinds] = useState<MediaKind[] | undefined>(accept);
  const [usage, setUsage] = useState<MediaUsageFilter>("any");
  const [sort, setSort] = useState<MediaSort>("newest");
  const [selectedItems, setSelectedItems] = useState<MediaItem[]>(initialItems);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  const [isDragOver, setIsDragOver] = useState(false);
  const [queueItems, setQueueItems] = useState<UploadQueueItem[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Tenant usage limits for upload pre-checks
  const usageQuery = useQuery({
    ...orpc.admin.media.usage.queryOptions(),
    enabled: true,
  });
  const usageData = usageQuery.data;

  // Subscribe to upload queue for the upload tab
  useEffect(() => {
    return mediaUploadQueue.subscribe((newQueue) => {
      setQueueItems(newQueue);
    });
  }, []);

  // Fetch library media
  const {
    items,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useMediaList({
    q,
    kinds: kinds ?? accept,
    usage,
    sort,
    trash: false,
    enabled: open,
  });

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current || !hasNextPage || isFetchingNextPage) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "150px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // When an upload succeeds, auto-select it and switch to Library tab
  useEffect(() => {
    return mediaUploadQueue.onUploadSuccess((uploadedItem) => {
      // Check if accepted kind
      if (accept && !accept.includes(uploadedItem.kind)) {
        return;
      }

      if (multiple) {
        setSelectedIds((prev) => {
          if (prev.includes(uploadedItem.id)) return prev;
          if (max && prev.length >= max) return prev;
          return [...prev, uploadedItem.id];
        });
        setSelectedItems((prev) => {
          if (prev.some((p) => p.id === uploadedItem.id)) return prev;
          if (max && prev.length >= max) return prev;
          return [...prev, uploadedItem];
        });
      } else {
        setSelectedIds([uploadedItem.id]);
        setSelectedItems([uploadedItem]);
      }
      setActiveTab("library");
      toast.success(`Uploaded and selected ${uploadedItem.filename || "file"}`);
    });
  }, [accept, multiple, max]);

  const toggleItemSelection = useCallback(
    (item: MediaItem) => {
      if (multiple) {
        if (selectedIds.includes(item.id)) {
          setSelectedIds((prev) => prev.filter((id) => id !== item.id));
          setSelectedItems((prev) => prev.filter((i) => i.id !== item.id));
        } else {
          if (max && selectedIds.length >= max) {
            toast.warning(`You can select at most ${max} item${max > 1 ? "s" : ""}.`);
            return;
          }
          setSelectedIds((prev) => [...prev, item.id]);
          setSelectedItems((prev) => [...prev, item]);
        }
      } else {
        if (selectedIds.includes(item.id)) {
          setSelectedIds([]);
          setSelectedItems([]);
        } else {
          setSelectedIds([item.id]);
          setSelectedItems([item]);
        }
      }
    },
    [multiple, selectedIds, max],
  );

  const handleConfirm = () => {
    // Resolve any items that might only be in selectedIds from initial props
    const resolved: MediaItem[] = [];
    for (const id of selectedIds) {
      const foundInCurrent = selectedItems.find((i) => i.id === id);
      if (foundInCurrent) {
        resolved.push(foundInCurrent);
      } else {
        const foundInLibrary = items.find((i) => i.id === id);
        if (foundInLibrary) {
          resolved.push(foundInLibrary);
        }
      }
    }
    onSelect(resolved.length > 0 ? resolved : selectedItems);
    onOpenChange(false);
  };

  const handleUploadFiles = (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    // Filter by accepted kinds if specified
    const filteredFiles: File[] = [];
    for (const f of fileList) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const match = ALLOWED_MEDIA_TYPES.find(
        (t) => t.mime === f.type || (t.extensions as readonly string[]).includes(ext),
      );
      if (accept && match && !accept.includes(match.kind as MediaKind)) {
        toast.error(`"${f.name}" is not an accepted file type for this field.`);
        continue;
      }
      filteredFiles.push(f);
    }

    if (filteredFiles.length > 0) {
      mediaUploadQueue.addFiles(filteredFiles, usageData);
      toast.info(
        `Queued ${filteredFiles.length} file${filteredFiles.length > 1 ? "s" : ""} for upload`,
      );
    }
  };

  return (
    <DialogContent className="w-full sm:max-w-4xl h-[92vh] sm:h-[82vh] flex flex-col p-0 gap-0 overflow-hidden max-w-full sm:rounded-lg">
        {/* Header */}
        <DialogHeader className="p-4 sm:p-5 border-b bg-card">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
              {accept && accept.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Accepts: {accept.join(", ")}
                </p>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "library" | "upload")}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="px-4 sm:px-5 pt-3 border-b bg-muted/20">
            <TabsList className="grid w-48 grid-cols-2 h-9">
              <TabsTrigger value="library" className="text-xs">
                Library
              </TabsTrigger>
              <TabsTrigger value="upload" className="text-xs">
                Upload
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Library Tab */}
          <TabsContent value="library" className="flex-1 flex flex-col min-h-0 m-0 p-4 sm:p-5">
            <MediaFiltersBar
              q={q}
              onQChange={setQ}
              kinds={kinds}
              onKindsChange={setKinds}
              allowedKinds={accept}
              usage={usage}
              onUsageChange={setUsage}
              sort={sort}
              onSortChange={setSort}
              showUsageFilter={false}
              className="mb-4"
            />

            {/* Media Grid */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-1">
              {isLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {Array.from({ length: 15 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-square rounded-lg border bg-muted/40 animate-pulse"
                    />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <EmptyState
                  title="No media found"
                  description={
                    q
                      ? "No files matched your search. Try different keywords."
                      : "No files available in this view. Upload files using the Upload tab."
                  }
                  action={
                    <Button
                      onClick={() => setActiveTab("upload")}
                      size="sm"
                      className="gap-1.5"
                    >
                      <Upload className="h-4 w-4" />
                      Upload now
                    </Button>
                  }
                />
              ) : (
                <div
                  role="grid"
                  aria-label="Selectable media files"
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
                >
                  {items.map((item) => {
                    const isSelected = selectedIds.includes(item.id);
                    const selectionNumber = multiple
                      ? selectedIds.indexOf(item.id) + 1 || undefined
                      : undefined;

                    return (
                      <MediaTile
                        key={item.id}
                        item={item}
                        isSelected={isSelected}
                        selectionNumber={selectionNumber}
                        showCheckbox={true}
                        hasActiveSelection={selectedIds.length > 0}
                        onClick={() => toggleItemSelection(item)}
                        onCheckboxClick={(e) => {
                          e.stopPropagation();
                          toggleItemSelection(item);
                        }}
                      />
                    );
                  })}
                </div>
              )}

              {/* Sentinel for infinite scroll */}
              {hasNextPage && (
                <div
                  ref={sentinelRef}
                  className="py-4 flex flex-col items-center justify-center gap-2"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="text-xs"
                  >
                    {isFetchingNextPage ? "Loading more..." : "Load more"}
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Upload Tab */}
          <TabsContent value="upload" className="flex-1 flex flex-col min-h-0 m-0 p-4 sm:p-5">
            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept={MEDIA_ACCEPT_ATTRIBUTE}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  handleUploadFiles(e.target.files);
                  e.target.value = "";
                }
              }}
            />

            {/* Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files) {
                  handleUploadFiles(e.dataTransfer.files);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-lg p-8 sm:p-12 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3",
                isDragOver
                  ? "border-primary bg-primary/5 scale-[0.99]"
                  : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/10",
              )}
            >
              <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center text-muted-foreground">
                <Upload className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-sm text-foreground">
                  Click to choose or drag and drop files here
                </p>
                <p className="text-xs text-muted-foreground">
                  Images up to 5 MB, Videos up to 10 MB, Documents up to 5 MB
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-2 pointer-events-none">
                Browse files
              </Button>
            </div>

            {/* Upload Queue in Dialog */}
            {queueItems.length > 0 && (
              <div className="mt-4 flex-1 min-h-0 flex flex-col">
                <div className="flex items-center justify-between pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <span>Recent uploads</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => mediaUploadQueue.clearCompleted()}
                  >
                    Clear completed
                  </Button>
                </div>
                <div className="overflow-y-auto flex-1 divide-y rounded-md border bg-card text-xs">
                  {queueItems.map((qItem) => (
                    <div key={qItem.id} className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{qItem.file.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatBytes(qItem.file.size)}
                        </p>
                        {qItem.status === "uploading" && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <Progress value={qItem.progress} className="h-1 flex-1" />
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {qItem.progress}%
                            </span>
                          </div>
                        )}
                        {qItem.error && (
                          <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
                            <AlertCircle className="h-3 w-3 shrink-0" />
                            {qItem.error}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {qItem.status === "success" && (
                          <Badge variant="secondary" className="text-emerald-600 gap-1 text-[11px]">
                            <Check className="h-3 w-3" /> Ready
                          </Badge>
                        )}
                        {qItem.status === "error" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => qItem.retry()}
                          >
                            <RotateCw className="h-3 w-3" /> Retry
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <DialogFooter className="p-4 sm:p-5 border-t bg-card flex flex-row items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {selectedIds.length > 0 ? (
              <span>
                <strong className="text-foreground">{selectedIds.length}</strong> selected
                {max ? ` (max ${max})` : ""}
              </span>
            ) : (
              <span>No item selected</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={selectedIds.length === 0}
              onClick={handleConfirm}
              className="min-w-[100px]"
            >
              {multiple
                ? `Insert (${selectedIds.length})`
                : selectedIds.length > 0
                  ? "Select file"
                  : "Insert"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
  );
}
