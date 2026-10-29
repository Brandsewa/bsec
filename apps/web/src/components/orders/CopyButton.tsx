"use client";

import { useState } from "react";

/** Copies a short value (a tracking number) and says so for a moment. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => undefined,
        );
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
