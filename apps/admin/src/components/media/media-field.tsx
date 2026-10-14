import React, { useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Image as ImageIcon,
  Lock,
  Upload,
  Video as VideoIcon,
  X,
} from "lucide-react";
import {
  Button,
  FieldDescription,
  FieldLabel,
  InfoTip,
  Skeleton,
  cn,
} from "@bs/ui";
import type { MediaItem, MediaKind } from "@bs/contracts";
import { orpc } from "../../lib/orpc.ts";
import { formatBytes, formatDuration } from "./format.ts";
import { MediaPickerDialog } from "./media-picker-dialog.tsx";

export interface MediaFieldProps {
  value: string | null | undefined;
  onChange: (mediaId: string | null, media?: MediaItem | null) => void;
  accept?: MediaKind[] | undefined;
  label?: string | undefined;
  aspect?: string | undefined;
  description?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function MediaField({
  value,
  onChange,
  accept = ["image"],
  label,
  aspect,
  description,
  disabled = false,
  className,
}: MediaFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // Permission check: requires content.write or store_owner
  const routeCtx = useRouteContext({ strict: false }) as
    | { store?: { permissions?: string[]; role?: string } }
    | undefined;

  const hasContentWrite =
    routeCtx?.store?.role === "store_owner" ||
    (routeCtx?.store?.permissions ?? []).includes("content.write");

  const isReadOnly = disabled || !hasContentWrite;

  // Load media details if value is present
  const { data: media, isLoading } = useQuery({
    ...orpc.admin.media.get.queryOptions({
      input: { id: value ?? "" },
    }),
    enabled: Boolean(value),
  });

  const handleSelect = (items: MediaItem[]) => {
    const selected = items[0];
    if (selected) {
      onChange(selected.id, selected);
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null, null);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {(label || !hasContentWrite || aspect) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <FieldLabel className="text-sm font-medium flex items-center gap-1.5">
              <span>{label}</span>
              {!hasContentWrite && (
                <InfoTip>You need permission to manage media (content.write)</InfoTip>
              )}
            </FieldLabel>
          )}
          {aspect && (
            <span className="text-xs text-muted-foreground font-mono">
              Aspect: {aspect}
            </span>
          )}
        </div>
      )}

      {isLoading && value ? (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20">
          <Skeleton className="h-16 w-16 rounded-md shrink-0" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ) : value && media ? (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/10 transition-colors">
          <div className="flex items-center gap-3 min-w-0">
            {/* Thumbnail */}
            <div className="h-16 w-16 rounded-md border border-border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0">
              {media.kind === "image" ? (
                <img
                  src={media.thumbnailUrl || media.url}
                  alt={media.alt || media.filename || ""}
                  className="h-full w-full object-cover"
                />
              ) : media.kind === "video" ? (
                <div className="relative h-full w-full flex items-center justify-center bg-black/10">
                  <VideoIcon className="h-6 w-6 text-purple-500" />
                  {Boolean(media.durationMs) && (
                    <span className="absolute bottom-1 right-1 text-[9px] bg-black/75 text-white px-1 rounded font-mono">
                      {formatDuration(media.durationMs)}
                    </span>
                  )}
                </div>
              ) : (
                <FileText className="h-6 w-6 text-emerald-500" />
              )}
            </div>

            {/* Info */}
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs font-medium truncate max-w-xs" title={media.filename || ""}>
                {media.filename || "Untitled"}
              </p>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{formatBytes(media.bytes)}</span>
                {Boolean(media.width && media.height) && (
                  <>
                    <span>•</span>
                    <span>
                      {media.width} × {media.height} px
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          {!isReadOnly && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setPickerOpen(true)}
              >
                Change
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={handleRemove}
                aria-label="Remove media"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* Empty State */
        <div
          onClick={() => {
            if (!isReadOnly) setPickerOpen(true);
          }}
          className={cn(
            "border border-dashed rounded-lg p-4 text-center transition-all flex items-center justify-between gap-3",
            isReadOnly
              ? "opacity-60 bg-muted/20 cursor-not-allowed"
              : "cursor-pointer hover:border-primary/50 hover:bg-muted/10",
          )}
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-8 w-8 rounded-md bg-muted/50 flex items-center justify-center text-muted-foreground shrink-0">
              <ImageIcon className="h-4 w-4" />
            </div>
            <span>No file selected</span>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isReadOnly}
            className="h-8 text-xs gap-1.5"
            onClick={(e) => {
              e.stopPropagation();
              if (!isReadOnly) setPickerOpen(true);
            }}
          >
            {isReadOnly ? (
              <>
                <Lock className="h-3.5 w-3.5" />
                Read-only
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" />
                Choose or upload
              </>
            )}
          </Button>
        </div>
      )}

      {description && <FieldDescription>{description}</FieldDescription>}

      {/* Picker Dialog */}
      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        accept={accept}
        multiple={false}
        selected={value ? [value] : []}
        onSelect={handleSelect}
        title={label ? `Select ${label.toLowerCase()}` : "Select media"}
      />
    </div>
  );
}
