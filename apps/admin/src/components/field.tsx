import type { ReactNode } from "react";
import { Label } from "@bs/ui";

/** Label + control + optional hint, used by plain (non react-hook-form) settings forms. */
export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-foreground-lighter">{hint}</p> : null}
    </div>
  );
}
