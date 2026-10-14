import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Image as ImageIcon,
  RotateCw,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { Badge, Button, Progress } from "@bs/ui";
import {
  mediaUploadQueue,
  type UploadQueueItem,
} from "../../lib/media-upload-queue.ts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function MediaUploadTray() {
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    return mediaUploadQueue.subscribe((newItems) => {
      setItems(newItems);
    });
  }, []);

  if (items.length === 0) {
    return null;
  }

  const activeCount = items.filter(
    (i) => i.status === "uploading" || i.status === "queued",
  ).length;
  const completedCount = items.filter((i) => i.status === "success").length;
  const errorCount = items.filter((i) => i.status === "error").length;

  return (
    <aside
      aria-label="Upload progress"
      className="fixed bottom-4 right-4 z-50 w-80 sm:w-96 rounded-lg border border-border bg-card text-card-foreground shadow-2xl overflow-hidden"
    >
      <header className="flex items-center justify-between border-b border-border/60 bg-muted/60 px-4 py-3 text-sm font-medium">
        <div className="flex items-center gap-2 truncate">
          <span>
            {activeCount > 0
              ? `Uploading ${activeCount} file${activeCount > 1 ? "s" : ""}...`
              : errorCount > 0
                ? `${errorCount} upload error${errorCount > 1 ? "s" : ""}`
                : `Uploads completed (${completedCount})`}
          </span>
          {activeCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 animate-pulse">
              In progress
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setMinimized((m) => !m)}
            aria-label={minimized ? "Expand upload tray" : "Minimize upload tray"}
          >
            {minimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => mediaUploadQueue.clearCompleted()}
            aria-label="Close and clear completed uploads"
            disabled={activeCount > 0}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {!minimized && (
        <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto p-0 m-0 list-none">
          {items.map((item) => {
            const isImage = item.file.type.startsWith("image/");
            const isVideo = item.file.type.startsWith("video/");

            return (
              <li key={item.id} className="p-4 text-xs space-y-1.5 hover:bg-muted/30">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isImage ? (
                      <ImageIcon className="h-4 w-4 shrink-0 text-blue-500" />
                    ) : isVideo ? (
                      <VideoIcon className="h-4 w-4 shrink-0 text-purple-500" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-emerald-500" />
                    )}
                    <span className="truncate font-medium text-foreground" title={item.file.name}>
                      {item.file.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {item.status === "success" && (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Done</span>
                      </span>
                    )}

                    {item.status === "uploading" && (
                      <span className="font-mono text-muted-foreground">{item.progress}%</span>
                    )}

                    {item.status === "queued" && (
                      <span className="text-muted-foreground">Queued</span>
                    )}

                    {item.status === "checking" && (
                      <span className="text-muted-foreground animate-pulse">Checking...</span>
                    )}

                    {item.status === "duplicate" && (
                      <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 text-[10px]">
                        Already in library
                      </Badge>
                    )}

                    {(item.status === "uploading" || item.status === "queued" || item.status === "checking") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground hover:text-foreground"
                        onClick={item.cancel}
                        title="Cancel upload"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}

                    {(item.status === "error" || item.status === "canceled") && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-foreground"
                          onClick={item.retry}
                          title="Retry upload"
                        >
                          <RotateCw className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-foreground"
                          onClick={() => mediaUploadQueue.removeItem(item.id)}
                          title="Remove item"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-muted-foreground text-[11px]">
                  <span>{formatBytes(item.file.size)}</span>
                </div>

                {item.status === "uploading" && (
                  <Progress value={item.progress} className="h-1.5" />
                )}

                {item.status === "duplicate" && item.duplicateOf && (
                  <div className="mt-1.5 p-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs space-y-1.5">
                    <div className="flex items-center gap-1.5 font-medium">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>Already in library</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        className="h-6 text-[11px] px-2 bg-amber-600 hover:bg-amber-700 text-white"
                        onClick={item.useExisting}
                      >
                        Use existing
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 text-[11px] px-2 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                        onClick={item.proceedUpload}
                      >
                        Upload anyway
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                        onClick={item.cancel}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {item.status === "error" && (
                  <div className="flex items-start gap-1.5 text-destructive font-normal text-[11px] mt-1">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="leading-tight">{item.error || "Upload failed"}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
