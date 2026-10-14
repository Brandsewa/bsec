import React from "react";
import { FileText, Video as VideoIcon } from "lucide-react";
import { Badge, Checkbox, cn } from "@bs/ui";
import type { MediaItem } from "@bs/contracts";
import { formatBytes, formatDuration } from "./format.ts";

export interface MediaTileProps {
  item: MediaItem;
  isSelected?: boolean | undefined;
  selectionNumber?: number | undefined;
  showCheckbox?: boolean | undefined;
  onCheckboxClick?: ((e: React.MouseEvent) => void) | undefined;
  onClick?: (() => void) | undefined;
  onKeyDown?: ((e: React.KeyboardEvent) => void) | undefined;
  showUsageBadge?: boolean | undefined;
  className?: string | undefined;
  hasActiveSelection?: boolean | undefined;
}

export function MediaTile({
  item,
  isSelected = false,
  selectionNumber,
  showCheckbox = true,
  onCheckboxClick,
  onClick,
  onKeyDown,
  showUsageBadge = true,
  className,
  hasActiveSelection = false,
}: MediaTileProps) {
  const ext = (item.filename || "").split(".").pop() || "";

  return (
    <div
      role="gridcell"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onKeyDown) {
          onKeyDown(e);
        } else {
          if (e.key === "Enter") onClick?.();
          if (e.key === " " && onCheckboxClick) {
            e.preventDefault();
            onCheckboxClick(e as unknown as React.MouseEvent);
          }
        }
      }}
      className={cn(
        "group relative aspect-square rounded-lg border bg-card text-card-foreground overflow-hidden cursor-pointer flex flex-col justify-between transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isSelected
          ? "ring-2 ring-primary border-primary bg-primary/5"
          : "hover:border-primary/50 hover:shadow-sm",
        className,
      )}
    >
      {/* Checkbox / Selection Number Overlay */}
      {showCheckbox && (
        <div
          className={cn(
            "absolute top-2 left-2 z-10 transition-opacity",
            isSelected || hasActiveSelection
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
          )}
          onClick={onCheckboxClick}
        >
          {typeof selectionNumber === "number" && isSelected ? (
            <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground font-semibold text-xs flex items-center justify-center shadow-sm">
              {selectionNumber}
            </div>
          ) : (
            <Checkbox
              checked={isSelected}
              aria-label={`Select ${item.filename || "file"}`}
              className="h-4 w-4 bg-background/90 shadow-sm"
            />
          )}
        </div>
      )}

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
        {showUsageBadge && item.usageCount > 0 && (
          <Badge
            variant="secondary"
            className="absolute top-2 right-2 text-[10px] px-1 py-0 bg-background/90 shadow-xs pointer-events-none"
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
}
