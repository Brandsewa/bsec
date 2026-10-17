import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  EmptyState,
  FormSkeleton,
  Input,
  PageSkeleton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SimpleSelect,
  Switch,
  toast,
} from "@bs/ui";
import type { CustomFieldDefinition, CustomFieldType } from "@bs/contracts";
import { SettingsCard, SettingsPageFrame } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/custom-fields")({
  pendingComponent: () => <PageSkeleton />,
  component: CustomFieldsSettingsPage,
});

const TITLE = "Custom fields";
const DESCRIPTION = "Add your own fields to products, such as ingredients or origin, then show them on product pages with the theme editor.";

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Single-line text",
  rich_text: "Rich text",
  image: "Image",
  dropdown: "Dropdown (choose one)",
  multi_select: "Multi-select (choose many)",
  number: "Number",
  boolean: "Yes / No",
};
const TYPE_OPTIONS = (Object.keys(TYPE_LABELS) as CustomFieldType[]).map((value) => ({ value, label: TYPE_LABELS[value] }));

interface OptionDraft {
  key: string;
  /** Present for options that already exist: keeps stored values pointing at the same option when the label changes. */
  value?: string | undefined;
  label: string;
}
let optionCounter = 0;
const newOption = (label = "", value?: string): OptionDraft => ({ key: `o${(optionCounter += 1)}`, label, value });

const keyFromName = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export function CustomFieldsSettingsPage() {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDefinition | "new" | null>(null);

  const query = useQuery(orpc.admin.customFields.listDefinitions.queryOptions({ input: { resourceType: "product", includeArchived: showArchived } }));
  const update = useMutation(orpc.admin.customFields.updateDefinition.mutationOptions());
  const archive = useMutation(orpc.admin.customFields.setArchived.mutationOptions());

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.customFields.key() });

  if (query.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <FormSkeleton />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }
  if (query.isError || !query.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <EmptyState title="Could not load custom fields" description={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>Try again</Button>} />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  const { enabled, definitions } = query.data;

  if (!enabled) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <EmptyState
            title="Custom fields are on the Growth plan and above"
            description="Upgrade your plan to add your own product fields and show them on your storefront."
            action={
              <Button nativeButton={false} render={<Link to="/settings/plan-and-billing" />}>View plans</Button>
            }
          />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  const active = definitions.filter((d) => !d.archived);

  async function move(def: CustomFieldDefinition, direction: -1 | 1) {
    const idx = active.findIndex((d) => d.id === def.id);
    const other = active[idx + direction];
    if (!other) return;
    try {
      // Swap positions; when both share a position (older rows) nudge by index.
      await Promise.all([
        update.mutateAsync({ id: def.id, position: idx + direction }),
        update.mutateAsync({ id: other.id, position: idx }),
      ]);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not reorder the fields"));
    }
  }

  async function toggleArchived(def: CustomFieldDefinition) {
    try {
      await archive.mutateAsync({ id: def.id, archived: !def.archived });
      toast.success(def.archived ? `"${def.name}" restored` : `"${def.name}" archived. Its values are kept.`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not update the field"));
    }
  }

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      <SettingsCard
        title="Product fields"
        description="These appear on every product's edit page"
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="mr-1.5 size-3.5" aria-hidden /> Add field
          </Button>
        }
      >
        {definitions.length === 0 ? (
          <EmptyState
            title="No custom fields yet"
            description="Add a field such as Ingredients, Origin or Care instructions. Each product can then fill it in."
            action={
              <Button onClick={() => setEditing("new")}>
                <Plus className="mr-1.5 size-4" aria-hidden /> Add field
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border border-border" aria-label="Product custom fields">
            {definitions.map((d) => {
              const idx = active.findIndex((a) => a.id === d.id);
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{d.name}</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{d.key}</code>
                      <Badge variant="secondary" className="text-[11px]">{TYPE_LABELS[d.type]}</Badge>
                      {d.required ? <Badge variant="outline" className="text-[11px]">Required</Badge> : null}
                      {!d.showOnStorefront ? <Badge variant="outline" className="text-[11px]">Hidden on storefront</Badge> : null}
                      {d.archived ? <Badge variant="outline" className="text-[11px]">Archived</Badge> : null}
                    </div>
                    {d.helpText ? <p className="mt-0.5 text-xs text-muted-foreground">{d.helpText}</p> : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {!d.archived ? (
                      <>
                        <Button size="sm" variant="ghost" disabled={idx <= 0 || update.isPending} onClick={() => void move(d, -1)} aria-label={`Move ${d.name} up`}>
                          <ArrowUp className="size-4" aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" disabled={idx === active.length - 1 || update.isPending} onClick={() => void move(d, 1)} aria-label={`Move ${d.name} down`}>
                          <ArrowDown className="size-4" aria-hidden />
                        </Button>
                      </>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => setEditing(d)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" disabled={archive.isPending} onClick={() => void toggleArchived(d)} aria-label={d.archived ? `Restore ${d.name}` : `Archive ${d.name}`}>
                      {d.archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showArchived} onCheckedChange={(c) => setShowArchived(Boolean(c))} aria-label="Show archived fields" />
          Show archived fields
        </label>
      </SettingsCard>

      <FieldSheet
        editing={editing}
        existingKeys={definitions.map((d) => d.key)}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />
    </SettingsPageFrame>
  );
}

function FieldSheet({
  editing,
  existingKeys,
  onClose,
  onSaved,
}: {
  editing: CustomFieldDefinition | "new" | null;
  existingKeys: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Sheet open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto p-0">
        {editing !== null ? <FieldForm key={editing === "new" ? "new" : editing.id} editing={editing} existingKeys={existingKeys} onClose={onClose} onSaved={onSaved} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function FieldForm({ editing, existingKeys, onClose, onSaved }: { editing: CustomFieldDefinition | "new"; existingKeys: string[]; onClose: () => void; onSaved: () => void }) {
  const isNew = editing === "new";
  const def = isNew ? null : editing;
  const [name, setName] = useState(def?.name ?? "");
  const [key, setKey] = useState(def?.key ?? "");
  const [keyEdited, setKeyEdited] = useState(false);
  const [type, setType] = useState<CustomFieldType>(def?.type ?? "text");
  const [helpText, setHelpText] = useState(def?.helpText ?? "");
  const [required, setRequired] = useState(def?.required ?? false);
  const [showOnStorefront, setShowOnStorefront] = useState(def?.showOnStorefront ?? true);
  const [options, setOptions] = useState<OptionDraft[]>(() => (def?.options.length ? def.options.map((o) => newOption(o.label, o.value)) : [newOption(), newOption()]));
  const [error, setError] = useState<string | null>(null);

  const create = useMutation(orpc.admin.customFields.createDefinition.mutationOptions());
  const update = useMutation(orpc.admin.customFields.updateDefinition.mutationOptions());
  const busy = create.isPending || update.isPending;
  const needsOptions = type === "dropdown" || type === "multi_select";

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName) return setError("Give the field a name.");
    const cleanedOptions = options.filter((o) => o.label.trim() !== "").map((o) => ({ ...(o.value ? { value: o.value } : {}), label: o.label.trim() }));
    if (needsOptions && cleanedOptions.length === 0) return setError("Add at least one option.");
    const effectiveKey = key.trim() || keyFromName(trimmedName);
    if (isNew && existingKeys.includes(effectiveKey)) return setError(`A field with the key "${effectiveKey}" already exists. Choose a different key.`);
    setError(null);
    try {
      if (isNew) {
        await create.mutateAsync({
          resourceType: "product",
          name: trimmedName,
          key: effectiveKey,
          type,
          helpText: helpText.trim() || null,
          required,
          showOnStorefront,
          ...(needsOptions ? { options: cleanedOptions } : {}),
        });
        toast.success(`"${trimmedName}" added`);
      } else if (def) {
        await update.mutateAsync({
          id: def.id,
          name: trimmedName,
          helpText: helpText.trim() || null,
          required,
          showOnStorefront,
          ...(needsOptions ? { options: cleanedOptions } : {}),
        });
        toast.success(`"${trimmedName}" saved`);
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "Could not save the field"));
    }
  }

  return (
    <>
      <SheetHeader className="border-b border-border p-5 sm:p-8">
        <SheetTitle>{isNew ? "Add custom field" : `Edit ${def?.name}`}</SheetTitle>
        <SheetDescription>
          {isNew ? "Choose what kind of information this field holds. The type cannot be changed later." : "The key and type stay the same so saved values keep working."}
        </SheetDescription>
      </SheetHeader>

      <div className="grid gap-6 p-5 text-xs sm:p-8">
        <div className="grid gap-1.5">
          <label htmlFor="cf-name" className="font-medium text-foreground">Field name</label>
          <Input
            id="cf-name"
            value={name}
            maxLength={80}
            placeholder="e.g. Ingredients"
            onChange={(e) => {
              setName(e.target.value);
              if (isNew && !keyEdited) setKey(keyFromName(e.target.value));
            }}
          />
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="cf-key" className="font-medium text-foreground">Key</label>
          <Input
            id="cf-key"
            value={key}
            maxLength={40}
            disabled={!isNew}
            onChange={(e) => {
              setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_"));
              setKeyEdited(true);
            }}
          />
          <p className="text-muted-foreground">Used by the theme editor to find this field. Letters, numbers and underscores. It cannot be changed later.</p>
        </div>

        <div className="grid gap-1.5">
          <span className="font-medium text-foreground">Type</span>
          {isNew ? (
            <SimpleSelect ariaLabel="Field type" value={type} onChange={(v) => setType(v as CustomFieldType)} options={TYPE_OPTIONS} />
          ) : (
            <Input aria-label="Field type" value={TYPE_LABELS[type]} disabled readOnly />
          )}
        </div>

        {needsOptions ? (
          <div className="grid gap-2">
            <span className="font-medium text-foreground">Options</span>
            {options.map((o, i) => (
              <div key={o.key} className="flex items-center gap-2">
                <Input
                  aria-label={`Option ${i + 1}`}
                  value={o.label}
                  maxLength={60}
                  placeholder={`Option ${i + 1}`}
                  onChange={(e) => setOptions((prev) => prev.map((x) => (x.key === o.key ? { ...x, label: e.target.value } : x)))}
                />
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={options.length <= 1} onClick={() => setOptions((prev) => prev.filter((x) => x.key !== o.key))} aria-label={`Remove option ${i + 1}`}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" disabled={options.length >= 50} onClick={() => setOptions((prev) => [...prev, newOption()])}>
                <Plus className="mr-1.5 size-3.5" aria-hidden /> Add option
              </Button>
            </div>
            {!isNew ? <p className="text-muted-foreground">Renaming an option keeps products that already chose it. Removing an option hides it from products that chose it.</p> : null}
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <label htmlFor="cf-help" className="font-medium text-foreground">Help text (optional)</label>
          <Input id="cf-help" value={helpText} maxLength={200} placeholder="Shown under the field on the product page" onChange={(e) => setHelpText(e.target.value)} />
        </div>

        <div className="grid gap-3">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-medium text-foreground">Required</span>
              <span className="text-muted-foreground">Every product must fill this in before it can be saved.</span>
            </span>
            <Switch checked={required} onCheckedChange={(c) => setRequired(Boolean(c))} aria-label="Required" />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-medium text-foreground">Show on storefront</span>
              <span className="text-muted-foreground">Lets the theme editor show this field on product pages.</span>
            </span>
            <Switch checked={showOnStorefront} onCheckedChange={(c) => setShowOnStorefront(Boolean(c))} aria-label="Show on storefront" />
          </label>
        </div>

        {error ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-popover px-5 py-4 sm:px-8">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving..." : isNew ? "Add field" : "Save field"}
        </Button>
      </div>
    </>
  );
}
