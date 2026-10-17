"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn.ts";

/** A short reference id (e.g. BCPID-1042) that copies to the clipboard on click. Falls back to a no-op without clipboard access. */
export function CopyableId({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure context, permissions); the id is still visible to copy by hand.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={`${label ?? "Copy"} ${value}`}
      title="Copy ID"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      {value}
      {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
    </button>
  );
}
