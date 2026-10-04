import type { ReactNode } from "react";
import { Field as ShadField, FieldDescription, FieldLabel } from "@/components/ui/field";

/** Label + control + optional hint, used by plain (non react-hook-form) forms. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <ShadField>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </ShadField>
  );
}
