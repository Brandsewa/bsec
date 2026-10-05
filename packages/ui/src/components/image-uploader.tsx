"use client";

import * as React from "react";
import { UploadCloud, X, Loader2 } from "lucide-react";
import { cn } from "../lib/cn.ts";

export interface UploadAdapter {
  upload(
    file: File,
    opts: { folder: string; signal: AbortSignal; onProgress: (p: number) => void },
  ): Promise<{ id: string; url: string; width?: number; height?: number; mime: string; bytes: number }>;
  remove?(id: string): Promise<void>;
}

export interface ImageUploaderProps {
  value?: string | string[];
  onChange?: (urls: string | string[]) => void;
  adapter?: UploadAdapter;
  folder?: string;
  maxFiles?: number;
  accept?: string;
  maxBytes?: number;
  className?: string;
}

export function ImageUploader({
  value,
  onChange,
  adapter,
  folder = "media",
  maxFiles = 1,
  accept = "image/png,image/jpeg,image/webp,image/svg+xml",
  maxBytes = 10 * 1024 * 1024,
  className,
}: ImageUploaderProps) {
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const images = Array.isArray(value) ? value : value ? [value] : [];

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);

    const file = files[0];
    if (!file) return;

    if (file.size > maxBytes) {
      setError(`File exceeds maximum size of ${Math.round(maxBytes / 1024 / 1024)}MB`);
      return;
    }

    if (!adapter) {
      // Local preview fallback if no adapter is passed
      const url = URL.createObjectURL(file);
      if (maxFiles === 1) {
        onChange?.(url);
      } else {
        onChange?.([...images, url]);
      }
      return;
    }

    setUploading(true);
    setProgress(0);
    const controller = new AbortController();

    try {
      const res = await adapter.upload(file, {
        folder,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });

      if (maxFiles === 1) {
        onChange?.(res.url);
      } else {
        onChange?.([...images, res.url]);
      }
    } catch (err: unknown) {
      setError((err as { message?: string })?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = (urlToRemove: string) => {
    if (maxFiles === 1) {
      onChange?.("");
    } else {
      onChange?.(images.filter((img) => img !== urlToRemove));
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex flex-col items-center justify-center p-6 border-2 border-dashed border-[var(--border)] rounded-lg hover:border-[var(--brand)] transition-colors cursor-pointer bg-[var(--card)] text-center",
          uploading && "pointer-events-none opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={maxFiles > 1}
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--brand)]" />
            <span className="text-xs text-[var(--muted-foreground)]">Uploading... {progress}%</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <UploadCloud className="h-6 w-6 text-[var(--muted-foreground)]" />
            <span className="text-xs font-medium">Click or drag images to upload</span>
            <span className="text-[11px] text-[var(--muted-foreground)]">Up to 10MB (PNG, JPG, WebP)</span>
          </div>
        )}
      </div>

      {error && <div className="text-xs text-[var(--destructive)] font-medium">{error}</div>}

      {images.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {images.map((url, idx) => (
            <div
              key={idx}
              className="relative h-20 w-20 rounded-md border border-[var(--border)] overflow-hidden group bg-[var(--muted)]"
            >
              <img src={url} alt="Uploaded preview" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(url);
                }}
                className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
                aria-label="Remove image"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
