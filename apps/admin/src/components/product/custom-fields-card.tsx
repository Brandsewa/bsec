import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldLabel, Input, MultiSelect, Switch, SimpleSelect, toast } from "@bs/ui";
import type { ResourceCustomField } from "@bs/contracts";
import { MediaField } from "../media/media-field.tsx";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

const RichFieldEditor = lazy(() => import("./rich-field-editor.tsx"));

type Values = Record<string, unknown>;

/** The editable form value of a stored value: text for text/number, html, an array, a media id, or a boolean. */
function initialValue(f: ResourceCustomField): unknown {
  const v = f.value;
  switch (f.definition.type) {
    case "image":
      return (v as { mediaId?: string } | null)?.mediaId ?? null;
    case "multi_select":
      return Array.isArray(v) ? v : [];
    case "boolean":
      return typeof v === "boolean" ? v : null;
    case "number":
      return v === null || v === undefined ? "" : String(v);
    default:
      return typeof v === "string" ? v : "";
  }
}

/** What to send for a form value: empty text, empty lists and cleared images are sent as null, which clears the field. */
function toSubmit(type: ResourceCustomField["definition"]["type"], v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (Array.isArray(v)) return v.length === 0 ? null : v;
  return v;
}

/**
 * Custom fields for one product (ADR-034): one input per field the store defined in Settings > Custom fields.
 * Saved on its own so it never interferes with the rest of the product form.
 */
export function CustomFieldsCard({ resourceType, resourceId }: { resourceType: "product" | "collection"; resourceId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(orpc.admin.customFields.getValues.queryOptions({ input: { resourceType, resourceId } }));
  const save = useMutation(orpc.admin.customFields.setValues.mutationOptions());

  if (query.isLoading || !query.data) return null;
  const { enabled, fields } = query.data;

  if (!enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Custom fields</CardTitle>
          <CardDescription>
            Add your own fields such as ingredients or origin. Available on the Growth plan and above.{" "}
            <Link to="/settings/plan-and-billing" className="text-primary underline">View plans</Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <FieldsForm
      key={JSON.stringify(fields.map((f) => [f.definition.id, f.value]))}
      fields={fields}
      saving={save.isPending}
      onSave={async (values) => {
        try {
          await save.mutateAsync({ resourceType, resourceId, values });
          toast.success("Custom fields saved");
          void queryClient.invalidateQueries({ queryKey: orpc.admin.customFields.getValues.key({ input: { resourceType, resourceId } }) });
        } catch (err) {
          toast.error(errorMessage(err, "Could not save the custom fields"));
        }
      }}
    />
  );
}

/** One custom field as a collapsible row: the field's name and whether it has a value show while it is closed. */
function FieldAccordionItem({ title, required, filled, defaultOpen, children }: { title: string; required: boolean; filled: boolean; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="text-sm font-medium text-foreground">
          {title}
          {required ? <span className="text-destructive"> *</span> : null}
        </span>
        <span className="flex items-center gap-2">
          <span className={filled ? "text-xs text-muted-foreground" : "text-xs text-muted-foreground/70"}>{filled ? "Filled in" : "Empty"}</span>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </span>
      </button>
      {open ? <div className="grid gap-1.5 border-t border-border px-3 py-3">{children}</div> : null}
    </div>
  );
}

function FieldsForm({ fields, saving, onSave }: { fields: ResourceCustomField[]; saving: boolean; onSave: (values: Values) => Promise<void> }) {
  const initial = useMemo(() => Object.fromEntries(fields.map((f) => [f.definition.id, initialValue(f)])), [fields]);
  const [values, setValues] = useState<Values>(initial);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const missing = fields.filter((f) => f.definition.required && toSubmit(f.definition.type, values[f.definition.id]) === null);

  if (fields.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Custom fields</CardTitle>
          <CardDescription>
            You have not added any fields yet. <Link to="/settings/custom-fields" className="text-primary underline">Add custom fields</Link> to record things like ingredients or origin.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const set = (id: string, v: unknown) => setValues((prev) => ({ ...prev, [id]: v }));
  const isSet = (f: ResourceCustomField) => toSubmit(f.definition.type, values[f.definition.id]) !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Custom fields</CardTitle>
        <CardDescription>
          Your own product information. Show it on the product page with the theme editor.{" "}
          <Link to="/settings/custom-fields" className="text-primary underline">Manage fields</Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {fields.map((f, index) => {
          const d = f.definition;
          const id = `cf-${d.id}`;
          const v = values[d.id];
          return (
            <FieldAccordionItem
              key={d.id}
              title={d.name}
              required={d.required}
              filled={isSet(f)}
              // Open what needs attention (a required field with no value) and, otherwise, the first field.
              defaultOpen={d.required ? !isSet(f) : index === 0}
            >
              <FieldLabel htmlFor={id} className="sr-only">
                {d.name}
              </FieldLabel>

              {d.type === "text" ? <Input id={id} value={(v as string) ?? ""} maxLength={500} onChange={(e) => set(d.id, e.target.value)} /> : null}
              {d.type === "number" ? <Input id={id} type="number" step="any" value={(v as string) ?? ""} onChange={(e) => set(d.id, e.target.value)} /> : null}
              {d.type === "rich_text" ? (
                <Suspense fallback={<div className="min-h-32 animate-pulse rounded-lg bg-muted/40" aria-hidden />}>
                  <RichFieldEditor value={(v as string) ?? ""} label={d.name} onChange={(html) => set(d.id, html)} />
                </Suspense>
              ) : null}
              {d.type === "image" ? <MediaField value={(v as string | null) ?? null} onChange={(mediaId) => set(d.id, mediaId)} /> : null}
              {d.type === "dropdown" ? (
                <SimpleSelect id={id} value={(v as string) ?? ""} onChange={(next) => set(d.id, next)} placeholder="Choose..." options={[{ value: "", label: "None" }, ...d.options.map((o) => ({ value: o.value, label: o.label }))]} />
              ) : null}
              {d.type === "multi_select" ? (
                <MultiSelect options={d.options.map((o) => ({ value: o.value, label: o.label }))} value={(v as string[]) ?? []} onChange={(next) => set(d.id, next)} placeholder="Choose..." searchPlaceholder="Search" />
              ) : null}
              {d.type === "boolean" ? (
                <div className="flex items-center gap-2">
                  <Switch id={id} checked={v === true} onCheckedChange={(c) => set(d.id, Boolean(c))} />
                  <span className="text-xs text-muted-foreground">{v === true ? "Yes" : v === false ? "No" : "Not set"}</span>
                </div>
              ) : null}

              {d.helpText ? <p className="text-xs text-muted-foreground">{d.helpText}</p> : null}
            </FieldAccordionItem>
          );
        })}

        {missing.length > 0 ? <p className="text-xs text-destructive">Required: {missing.map((f) => f.definition.name).join(", ")}</p> : null}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!dirty || saving} onClick={() => setValues(initial)}>
            Discard
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!dirty || saving || missing.length > 0}
            onClick={() => void onSave(Object.fromEntries(fields.map((f) => [f.definition.id, toSubmit(f.definition.type, values[f.definition.id])])))}
          >
            {saving ? "Saving..." : "Save custom fields"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
