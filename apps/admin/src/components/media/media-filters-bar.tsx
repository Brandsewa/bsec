import React from "react";
import { Search } from "lucide-react";
import { Button, Input, SimpleSelect } from "@bs/ui";
import type { MediaKind } from "@bs/contracts";

export type MediaSort = "newest" | "oldest" | "name" | "largest";
export type MediaUsageFilter = "any" | "used" | "unused";

export const SORT_OPTIONS: Array<{ value: MediaSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "File name (A–Z)" },
  { value: "largest", label: "Size (largest first)" },
];

export const USAGE_OPTIONS: Array<{ value: MediaUsageFilter; label: string }> = [
  { value: "any", label: "All usages" },
  { value: "used", label: "Used in store" },
  { value: "unused", label: "Unused" },
];

export interface MediaFiltersBarProps {
  q: string;
  onQChange: (q: string) => void;
  kinds?: MediaKind[] | undefined;
  onKindsChange: (kinds: MediaKind[] | undefined) => void;
  allowedKinds?: readonly MediaKind[] | undefined;
  usage?: MediaUsageFilter | undefined;
  onUsageChange?: ((usage: MediaUsageFilter) => void) | undefined;
  showUsageFilter?: boolean | undefined;
  sort: MediaSort;
  onSortChange: (sort: MediaSort) => void;
  children?: React.ReactNode | undefined; // e.g. View toggle buttons
  className?: string | undefined;
}

export function MediaFiltersBar({
  q,
  onQChange,
  kinds,
  onKindsChange,
  allowedKinds,
  usage = "any",
  onUsageChange,
  showUsageFilter = true,
  sort,
  onSortChange,
  children,
  className,
}: MediaFiltersBarProps) {
  const showImages = !allowedKinds || allowedKinds.includes("image");
  const showVideos = !allowedKinds || allowedKinds.includes("video");
  const showDocs = !allowedKinds || allowedKinds.includes("document");

  // Only show kind toggle pills if more than 1 kind is allowed
  const multiKind = [showImages, showVideos, showDocs].filter(Boolean).length > 1;

  return (
    <div className={`space-y-3 ${className || ""}`}>
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            placeholder="Search by filename or title..."
            className="pl-8 h-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {multiKind && (
            <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-md border text-xs">
              <Button
                variant={!kinds || kinds.length === 0 ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => onKindsChange(undefined)}
              >
                All
              </Button>
              {showImages && (
                <Button
                  variant={kinds?.length === 1 && kinds[0] === "image" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => onKindsChange(["image"])}
                >
                  Images
                </Button>
              )}
              {showVideos && (
                <Button
                  variant={kinds?.length === 1 && kinds[0] === "video" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => onKindsChange(["video"])}
                >
                  Videos
                </Button>
              )}
              {showDocs && (
                <Button
                  variant={kinds?.length === 1 && kinds[0] === "document" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => onKindsChange(["document"])}
                >
                  Docs
                </Button>
              )}
            </div>
          )}

          {showUsageFilter && onUsageChange && (
            <div className="w-[140px]">
              <SimpleSelect
                value={usage}
                onChange={(val: string) => onUsageChange(val as MediaUsageFilter)}
                options={USAGE_OPTIONS}
              />
            </div>
          )}

          <div className="w-[150px]">
            <SimpleSelect
              value={sort}
              onChange={(val: string) => onSortChange(val as MediaSort)}
              options={SORT_OPTIONS}
            />
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
