import { Label as L } from "radix-ui";
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react";
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { cn } from "../lib/cn.ts";

/** React Hook Form bindings + FormItemLayout (Supabase forms pattern). */
export const Form = FormProvider;

export function Label({ className, ...props }: ComponentProps<typeof L.Root>) {
  return <L.Root className={cn("text-sm font-medium text-foreground-light", className)} {...props} />;
}

interface FieldCtx {
  id: string;
  name: string;
}
const FieldContext = createContext<FieldCtx | null>(null);

export function FormField<TValues extends FieldValues, TName extends FieldPath<TValues>>(
  props: ControllerProps<TValues, TName>,
) {
  const id = useId();
  return (
    <FieldContext value={{ id, name: props.name }}>
      <Controller {...props} />
    </FieldContext>
  );
}

function useField() {
  const field = useContext(FieldContext);
  if (!field) throw new Error("FormItemLayout must be used inside <FormField>");
  const { getFieldState, formState } = useFormContext();
  const state = getFieldState(field.name, formState);
  return { ...field, error: state.error?.message };
}

/**
 * Label, control, description and error laid out consistently.
 * layout="horizontal" puts the label in a left column on wide screens (settings pages).
 */
export function FormItemLayout({
  label,
  description,
  layout = "vertical",
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  layout?: "vertical" | "horizontal";
  children: (a11y: { id: string; "aria-invalid": boolean; "aria-describedby": string }) => ReactNode;
}) {
  const { id, error } = useField();
  const descId = `${id}-desc`;
  const errId = `${id}-err`;
  return (
    <div className={cn("grid gap-2", layout === "horizontal" && "md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-6")}>
      <Label htmlFor={id}>{label}</Label>
      <div className="grid gap-1.5">
        {children({ id, "aria-invalid": Boolean(error), "aria-describedby": error ? errId : descId })}
        {description ? (
          <p id={descId} className="text-xs text-foreground-lighter">
            {description}
          </p>
        ) : null}
        {error ? (
          <p id={errId} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

