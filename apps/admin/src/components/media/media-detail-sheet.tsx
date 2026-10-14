import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Copy,
  Download,
  ExternalLink,
  FileText,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  FieldLabel,
  InfoTip,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Textarea,
  cn,
  toast,
} from "@bs/ui";
import type { MediaDetailItem, MediaItem } from "@bs/contracts";
import { client, orpc } from "../../lib/orpc.ts";
import { replaceMediaFile } from "../../lib/media-upload-queue.ts";

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

interface MediaDetailContentProps {
  item: MediaDetailItem;
  onClose: () => void;
  onItemTrashed?: ((id: string) => void) | undefined;
  onItemRestored?: ((id: string) => void) | undefined;
  onItemDeleted?: ((id: string) => void) | undefined;
}

function MediaDetailContent({
  item,
  onClose,
  onItemTrashed,
  onItemRestored,
  onItemDeleted,
}: MediaDetailContentProps) {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState(item.title || "");
  const [alt, setAlt] = useState(item.alt || "");
  const [caption, setCaption] = useState(item.caption || "");
  const [focalX, setFocalX] = useState<number | null>(item.focalX ?? null);
  const [focalY, setFocalY] = useState<number | null>(item.focalY ?? null);
  const [trashConfirmOpen, setTrashConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setFocalX(Math.round(x * 1000) / 1000);
    setFocalY(Math.round(y * 1000) / 1000);
  };

  const handleMarkerKeyDown = (e: React.KeyboardEvent) => {
    if (focalX === null || focalY === null) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    let nextX = focalX;
    let nextY = focalY;
    if (e.key === "ArrowLeft") {
      nextX = Math.max(0, Math.min(1, focalX - step));
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      nextX = Math.max(0, Math.min(1, focalX + step));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      nextY = Math.max(0, Math.min(1, focalY - step));
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      nextY = Math.max(0, Math.min(1, focalY + step));
      e.preventDefault();
    } else {
      return;
    }
    setFocalX(Math.round(nextX * 1000) / 1000);
    setFocalY(Math.round(nextY * 1000) / 1000);
  };

  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setIsReplacing(true);
    try {
      const updated = await replaceMediaFile(item.id, file, {
        expectedKind: item.kind,
      });
      toast.success("File replaced successfully");
      queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
      if (updated) {
        queryClient.setQueryData(
          orpc.admin.media.get.queryOptions({ input: { id: item.id } }).queryKey,
          (prev: MediaItem | undefined) => (prev ? { ...prev, ...updated } : prev),
        );
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to replace file");
    } finally {
      setIsReplacing(false);
    }
  };

  const isDirty =
    title !== (item.title || "") ||
    alt !== (item.alt || "") ||
    caption !== (item.caption || "") ||
    focalX !== (item.focalX ?? null) ||
    focalY !== (item.focalY ?? null);

  const updateMutation = useMutation({
    mutationFn: async () => {
      return await client.admin.media.update({
        id: item.id,
        title: title.trim() || undefined,
        alt: alt.trim() || undefined,
        caption: caption.trim() || undefined,
        focalX,
        focalY,
      });
    },
    onSuccess: (updated) => {
      toast.success("Media details updated");
      queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
      if (updated) {
        queryClient.setQueryData(
          orpc.admin.media.get.queryOptions({ input: { id: item.id } }).queryKey,
          (prev: MediaItem | undefined) => (prev ? { ...prev, ...updated } : prev),
        );
      }
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to update media");
    },
  });

  const trashMutation = useMutation({
    mutationFn: async () => {
      return await client.admin.media.trash({ ids: [item.id] });
    },
    onSuccess: () => {
      toast.success("Moved to Trash");
      queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
      onItemTrashed?.(item.id);
      onClose();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to move to Trash");
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      return await client.admin.media.restore({ ids: [item.id] });
    },
    onSuccess: () => {
      toast.success("Restored from Trash");
      queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
      onItemRestored?.(item.id);
      onClose();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to restore");
    },
  });

  const deletePermanentMutation = useMutation({
    mutationFn: async () => {
      return await client.admin.media.deletePermanent({ ids: [item.id] });
    },
    onSuccess: (res) => {
      if (res && res.blocked.length > 0) {
        toast.error("Cannot permanently delete file while it is used in catalog");
        return;
      }
      toast.success("File permanently deleted");
      queryClient.invalidateQueries({ queryKey: ["admin", "media"] });
      onItemDeleted?.(item.id);
      onClose();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to permanently delete");
    },
  });

  const handleCopyLink = () => {
    if (!item.url) return;
    navigator.clipboard.writeText(item.url);
    toast.success("Link copied to clipboard");
  };

  return (
    <div className="space-y-6 flex-1">
      {/* Preview Section */}
      <div className="rounded-lg border bg-muted/20 p-2 overflow-hidden flex items-center justify-center min-h-[200px] max-h-[320px]">
        {item.kind === "image" && (
          <div
            className="relative inline-block cursor-crosshair select-none max-h-[300px]"
            onClick={handleImageClick}
          >
            <img
              src={item.url}
              alt={item.alt || item.filename || ""}
              className="max-h-[300px] w-auto max-w-full object-contain rounded-md block pointer-events-none"
            />
            {focalX !== null && focalY !== null && (
              <div
                role="button"
                tabIndex={0}
                aria-label="Focal point marker. Use arrow keys to adjust."
                onKeyDown={handleMarkerKeyDown}
                onClick={(e) => e.stopPropagation()}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white bg-primary shadow-[0_0_0_1px_rgba(0,0,0,0.5),0_2px_4px_rgba(0,0,0,0.4)] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 pointer-events-auto cursor-move"
                style={{ left: `${focalX * 100}%`, top: `${focalY * 100}%` }}
              >
                <div className="w-1 h-1 rounded-full bg-white" />
              </div>
            )}
          </div>
        )}
        {item.kind === "video" && (
          <video
            src={item.url}
            controls
            preload="metadata"
            className="max-h-[300px] w-full rounded-md bg-black"
          />
        )}
        {item.kind === "document" && (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <FileText className="h-16 w-16 text-muted-foreground mb-3" />
            <p className="font-medium text-sm text-foreground max-w-xs truncate mb-4">
              {item.filename}
            </p>
            <Button variant="outline" size="sm" asChild>
              <a
                href={item.url}
                target={item.mime === "application/pdf" ? "_blank" : undefined}
                download={item.mime !== "application/pdf" ? item.filename : undefined}
                rel="noopener noreferrer"
                className="gap-2"
              >
                {item.mime === "application/pdf" ? (
                  <>
                    Open PDF <ExternalLink className="h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    Download <Download className="h-3.5 w-3.5" />
                  </>
                )}
              </a>
            </Button>
          </div>
        )}
      </div>

      {/* Quick Actions Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleCopyLink} className="gap-1.5">
          <Copy className="h-3.5 w-3.5" />
          Copy link
        </Button>
        <Button variant="outline" size="sm" asChild className="gap-1.5">
          <a href={item.url} download={item.filename}>
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        </Button>
        {item.status === "ready" && (
          <>
            <input
              type="file"
              ref={replaceInputRef}
              onChange={handleReplaceFile}
              className="hidden"
              accept={
                item.kind === "image"
                  ? "image/jpeg,image/png,image/webp,image/gif,image/avif"
                  : item.kind === "video"
                    ? "video/mp4,video/webm,video/quicktime"
                    : ".pdf,.csv,.txt"
              }
            />
            <Button
              variant="outline"
              size="sm"
              disabled={isReplacing}
              onClick={() => replaceInputRef.current?.click()}
              className="gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isReplacing && "animate-spin")} />
              {isReplacing ? "Replacing..." : "Replace file"}
            </Button>
          </>
        )}
        {item.status === "ready" ? (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10 gap-1.5 ml-auto"
            onClick={() => setTrashConfirmOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Move to Trash
          </Button>
        ) : (
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => restoreMutation.mutate()}
              disabled={restoreMutation.isPending}
            >
              <Undo2 className="h-3.5 w-3.5" />
              Restore
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete permanently
            </Button>
          </div>
        )}
      </div>

      {/* Focal Point & Crop Previews */}
      {item.kind === "image" && (
        <div className="space-y-3 rounded-lg border p-4 bg-card">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Focal point & crop previews</h4>
              <p className="text-xs text-muted-foreground">
                Click image above to set focal point. Controls crop positioning across devices.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setFocalX(0.5);
                  setFocalY(0.5);
                }}
              >
                Reset (50% 50%)
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                disabled={focalX === null && focalY === null}
                onClick={() => {
                  setFocalX(null);
                  setFocalY(null);
                }}
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            {focalX !== null && focalY !== null ? (
              <span>
                Position:{" "}
                <span className="font-mono text-foreground font-medium">
                  {Math.round(focalX * 100)}% {Math.round(focalY * 100)}%
                </span>{" "}
                (arrow keys nudge 1%, Shift+arrow 5%)
              </span>
            ) : (
              <span className="italic">No custom focal point set (defaults to center 50% 50%).</span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 pt-1">
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">1:1 Square</span>
              <div className="aspect-square w-full overflow-hidden rounded border bg-muted/30">
                <img
                  src={item.url}
                  alt="1:1 crop preview"
                  className="h-full w-full object-cover"
                  style={{
                    objectPosition: `${(focalX ?? 0.5) * 100}% ${(focalY ?? 0.5) * 100}%`,
                  }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">4:5 Card</span>
              <div className="aspect-[4/5] w-full overflow-hidden rounded border bg-muted/30">
                <img
                  src={item.url}
                  alt="4:5 crop preview"
                  className="h-full w-full object-cover"
                  style={{
                    objectPosition: `${(focalX ?? 0.5) * 100}% ${(focalY ?? 0.5) * 100}%`,
                  }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">16:9 Hero</span>
              <div className="aspect-[16/9] w-full overflow-hidden rounded border bg-muted/30">
                <img
                  src={item.url}
                  alt="16:9 crop preview"
                  className="h-full w-full object-cover"
                  style={{
                    objectPosition: `${(focalX ?? 0.5) * 100}% ${(focalY ?? 0.5) * 100}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metadata Fields Form */}
      <div className="space-y-4 rounded-lg border p-4 bg-card">
        <Field>
          <FieldLabel>Title</FieldLabel>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Descriptive title"
          />
        </Field>

        <Field>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <FieldLabel>Alt text</FieldLabel>
              <InfoTip>
                Alt text describes this media for screen readers and search engines. It is
                essential for accessibility and improves SEO ranking.
              </InfoTip>
            </div>
            {item.kind === "image" && !alt.trim() && (
              <Badge
                variant="outline"
                className="border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 text-[10px]"
              >
                No alt text
              </Badge>
            )}
          </div>
          <Textarea
            value={alt}
            onChange={(e) => setAlt(e.target.value.slice(0, 512))}
            placeholder="Describe the image content and purpose"
            rows={2}
            maxLength={512}
          />
          <div className="text-[11px] text-muted-foreground text-right">
            {alt.length}/512
          </div>
        </Field>

        <Field>
          <FieldLabel>Caption</FieldLabel>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Optional caption displayed under the media"
            rows={2}
          />
        </Field>

        <Button
          size="sm"
          onClick={() => updateMutation.mutate()}
          disabled={!isDirty || updateMutation.isPending}
          className="w-full sm:w-auto"
        >
          {updateMutation.isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>

      {/* Used In List */}
      <div className="space-y-3 rounded-lg border p-4 bg-card">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Used in</h4>
          <Badge variant="secondary" className="text-xs">
            {item.usages.length} reference{item.usages.length === 1 ? "" : "s"}
          </Badge>
        </div>

        {item.usages.length === 0 ? (
          <p className="text-xs text-muted-foreground">Not used anywhere</p>
        ) : (
          <ul className="divide-y text-xs list-none p-0 m-0">
            {item.usages.map((usage, idx) => (
              <li key={idx} className="py-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 truncate">
                  <Badge variant="outline" className="capitalize text-[10px]">
                    {usage.ownerType}
                  </Badge>
                  <span className="truncate font-medium">{usage.label}</span>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" asChild>
                  <Link to={usage.adminPath}>
                    View <ExternalLink className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Read-only Facts */}
      <div className="space-y-2 rounded-lg border p-4 bg-muted/20 text-xs">
        <h4 className="font-semibold text-foreground mb-2">File information</h4>
        <div className="grid grid-cols-2 gap-y-2 text-muted-foreground">
          <span>File name:</span>
          <span className="font-mono text-foreground truncate text-right">
            {item.filename || "—"}
          </span>

          <span>Type:</span>
          <span className="text-foreground capitalize text-right">
            {item.kind} ({item.mime})
          </span>

          {Boolean(item.width && item.height) && (
            <>
              <span>Dimensions:</span>
              <span className="text-foreground text-right">
                {item.width} × {item.height} px
              </span>
            </>
          )}

          {Boolean(item.durationMs) && (
            <>
              <span>Duration:</span>
              <span className="text-foreground text-right">
                {formatDuration(item.durationMs)}
              </span>
            </>
          )}

          <span>File size:</span>
          <span className="text-foreground text-right">{formatBytes(item.bytes)}</span>

          <span>Uploaded at:</span>
          <span className="text-foreground text-right">
            {new Date(item.createdAt).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        open={trashConfirmOpen}
        onOpenChange={setTrashConfirmOpen}
        title="Move to Trash"
        description={
          item.usages && item.usages.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>This file is currently used in {item.usages.length} catalog location(s).</span>
              </div>
              <p>
                It will continue to be displayed on your live storefront until removed from its
                products or collections. Move to Trash?
              </p>
            </div>
          ) : (
            "Move this file to Trash? It can be restored within 30 days."
          )
        }
        confirmLabel="Move to Trash"
        destructive
        onConfirm={() => trashMutation.mutate()}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete permanently"
        description="Permanently delete this file and remove its storage object? This action cannot be undone."
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => deletePermanentMutation.mutate()}
      />
    </div>
  );
}

interface MediaDetailSheetProps {
  mediaId: string | null;
  onClose: () => void;
  onItemTrashed?: ((id: string) => void) | undefined;
  onItemRestored?: ((id: string) => void) | undefined;
  onItemDeleted?: ((id: string) => void) | undefined;
}

export function MediaDetailSheet({
  mediaId,
  onClose,
  onItemTrashed,
  onItemRestored,
  onItemDeleted,
}: MediaDetailSheetProps) {
  const { data: item, isLoading } = useQuery({
    ...orpc.admin.media.get.queryOptions({
      input: { id: mediaId ?? "" },
    }),
    enabled: Boolean(mediaId),
  });

  return (
    <Sheet open={Boolean(mediaId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto p-4 sm:p-6 flex flex-col gap-6"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="truncate">
            {isLoading ? <Skeleton className="h-6 w-48" /> : item?.filename || "Media details"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            View and manage file metadata, alt text, and catalog usages.
          </SheetDescription>
        </SheetHeader>

        {isLoading || !item ? (
          <div className="space-y-6">
            <Skeleton className="h-56 w-full rounded-md" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <MediaDetailContent
            key={item.id}
            item={item}
            onClose={onClose}
            onItemTrashed={onItemTrashed}
            onItemRestored={onItemRestored}
            onItemDeleted={onItemDeleted}
          />
        )}

        <SheetFooter className="mt-auto pt-4 border-t">
          <Button variant="outline" onClick={onClose} className="w-full">
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
