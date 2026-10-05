import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@bs/ui";
import { Input } from "@bs/ui";
import { Skeleton } from "@bs/ui";
import { SimpleSelect } from "@bs/ui";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

/**
 * The automatic-segment condition builder and its live preview (Customers Segments PLAN §6).
 * Fields and operators come from the whitelist; values are plain JSON the domain re-validates.
 * SimpleSelect has no option groups, so field options are ordered by group with the group in
 * the label.
 */

export interface Condition {
  field: string;
  op: string;
  value: unknown;
}

export interface RuleSet {
  match: "all" | "any";
  conditions: Condition[];
}

type ValueKind = "int" | "rupees" | "days" | "never" | "none" | "datesBetween" | "marketingState" | "tag" | "bool" | "state" | "pincode" | "productId" | "collectionId" | "segment";

const FIELD_GROUPS: Array<{ group: string; fields: Array<{ id: string; label: string; ops: Array<[string, string]>; kind: ValueKind }> }> = [
  {
    group: "Orders and spend",
    fields: [
      { id: "orders_count", label: "Orders (counted)", ops: [["gte", "at least"], ["lte", "at most"], ["eq", "exactly"]], kind: "int" },
      { id: "total_spent", label: "Total spent", ops: [["gte", "at least"], ["lte", "at most"], ["between", "between"]], kind: "rupees" },
      { id: "average_order_value", label: "Average order value", ops: [["gte", "at least"], ["lte", "at most"]], kind: "rupees" },
    ],
  },
  {
    group: "Activity",
    fields: [
      { id: "last_order_at", label: "Last order", ops: [["within_days", "within (days)"], ["older_than_days", "older than (days)"], ["never", "never placed"]], kind: "days" },
      { id: "first_order_at", label: "First order", ops: [["within_days", "within (days)"], ["older_than_days", "older than (days)"]], kind: "days" },
      { id: "created_at", label: "Joined", ops: [["within_days", "within (days)"], ["older_than_days", "older than (days)"], ["between_dates", "between dates"]], kind: "days" },
      { id: "abandoned_checkout", label: "Abandoned a checkout", ops: [["within_days", "within (days)"]], kind: "days" },
      { id: "returned", label: "Requested a return", ops: [["has", "has"], ["has_not", "has not"]], kind: "none" },
    ],
  },
  { group: "Marketing", fields: [{ id: "marketing_state", label: "Marketing consent", ops: [["is", "is"], ["is_not", "is not"]], kind: "marketingState" }] },
  {
    group: "Location",
    fields: [
      { id: "state", label: "State (default address)", ops: [["is", "is"], ["is_not", "is not"], ["in", "is one of"]], kind: "state" },
      { id: "pincode", label: "PIN code (default address)", ops: [["starts_with", "starts with"], ["is", "is"]], kind: "pincode" },
    ],
  },
  {
    group: "Products",
    fields: [
      { id: "bought_product", label: "Bought product", ops: [["has", "has"], ["has_not", "has not"]], kind: "productId" },
      { id: "bought_collection", label: "Bought from collection", ops: [["has", "has"], ["has_not", "has not"]], kind: "collectionId" },
    ],
  },
  {
    group: "Other",
    fields: [
      { id: "tags", label: "Tag", ops: [["has", "has"], ["has_not", "has not"]], kind: "tag" },
      { id: "is_guest", label: "Guest (no account)", ops: [["is", "is"]], kind: "bool" },
      { id: "in_segment", label: "In segment", ops: [["is", "is"], ["is_not", "is not"]], kind: "segment" },
    ],
  },
];

const ALL_FIELDS = FIELD_GROUPS.flatMap((g) => g.fields.map((f) => ({ ...f, group: g.group })));
const FIELD_KIND = new Map(ALL_FIELDS.map((f) => [f.id, f.kind]));

export const opsForField = (field: string) => ALL_FIELDS.find((f) => f.id === field)?.ops ?? [];

/** The default value for a field+op, always valid for the rule whitelist. */
export function defaultValueFor(field: string, op: string): unknown {
  if (op === "never") return null;
  switch (FIELD_KIND.get(field)) {
    case "never":
    case "none":
      return null;
    case "marketingState":
      return "subscribed";
    case "bool":
      return true;
    case "rupees":
      return op === "between" ? [0, 0] : 0;
    case "datesBetween":
      return ["", ""];
    default:
      return 0;
  }
}

/**
 * Normalises UI state into payload shape: `state in` is typed as a comma string in the
 * editor and becomes a code array here, empty between-bounds become 0, blank dates are
 * dropped (the domain's validation reports anything genuinely wrong).
 */
export function normalizeRules(rules: RuleSet): RuleSet {
  return {
    match: rules.match,
    conditions: rules.conditions.map((c) => {
      if (c.field === "state" && c.op === "in" && typeof c.value === "string") {
        return { ...c, value: c.value.split(",").map((s) => s.trim()).filter(Boolean) };
      }
      return c;
    }),
  };
}

function ValueEditor({ condition, onChange }: { condition: Condition; onChange: (value: unknown) => void }) {
  const products = useQuery(orpc.admin.products.list.queryOptions({ input: { limit: 100 } }));
  const collections = useQuery(orpc.admin.collections.list.queryOptions({ input: undefined }));
  const segments = useQuery(orpc.admin.segments.list.queryOptions({ input: { limit: 100 } }));
  const kind = FIELD_KIND.get(condition.field);

  switch (kind) {
    case "int":
    case "days":
      return <Input aria-label="Condition value" type="number" className="w-32" value={typeof condition.value === "number" ? condition.value : ""} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />;
    case "rupees": {
      if (condition.op === "between") {
        const [lo, hi] = Array.isArray(condition.value) ? condition.value : [0, 0];
        return (
          <div className="flex items-center gap-1">
            <Input aria-label="Minimum rupees" type="number" className="w-28" value={lo / 100} onChange={(e) => onChange([Number(e.target.value) * 100, hi])} />
            <span className="text-muted-foreground">and</span>
            <Input aria-label="Maximum rupees" type="number" className="w-28" value={hi / 100} onChange={(e) => onChange([lo, Number(e.target.value) * 100])} />
          </div>
        );
      }
      return <Input aria-label="Rupees" type="number" className="w-32" value={typeof condition.value === "number" ? condition.value / 100 : ""} onChange={(e) => onChange(Number(e.target.value) * 100)} />;
    }
    case "datesBetween": {
      const [from, to] = Array.isArray(condition.value) ? condition.value : ["", ""];
      return (
        <div className="flex items-center gap-1">
          <Input aria-label="From date" type="date" className="w-40" value={from} onChange={(e) => onChange([e.target.value, to])} />
          <span className="text-muted-foreground">and</span>
          <Input aria-label="To date" type="date" className="w-40" value={to} onChange={(e) => onChange([from, e.target.value])} />
        </div>
      );
    }
    case "marketingState":
      return (
        <SimpleSelect
          ariaLabel="Marketing state"
          className="w-44"
          value={typeof condition.value === "string" ? condition.value : "subscribed"}
          options={[
            { value: "subscribed", label: "Subscribed" },
            { value: "unsubscribed", label: "Unsubscribed" },
            { value: "not_subscribed", label: "Not subscribed" },
          ]}
          onChange={onChange}
        />
      );
    case "bool":
      return (
        <SimpleSelect
          ariaLabel="Guest state"
          className="w-32"
          value={String(condition.value === true)}
          options={[
            { value: "true", label: "Guests" },
            { value: "false", label: "Accounts" },
          ]}
          onChange={(v) => onChange(v === "true")}
        />
      );
    case "tag":
      return <Input aria-label="Tag" className="w-40" value={typeof condition.value === "string" ? condition.value : ""} onChange={(e) => onChange(e.target.value)} placeholder="e.g. VIP" />;
    case "state":
      if (condition.op === "in") {
        return <Input aria-label="State codes" className="w-44 uppercase" value={typeof condition.value === "string" ? condition.value : ""} onChange={(e) => onChange(e.target.value.toUpperCase())} placeholder="KA, MH" />;
      }
      return <Input aria-label="State code" className="w-24 uppercase" maxLength={3} value={typeof condition.value === "string" ? condition.value : ""} onChange={(e) => onChange(e.target.value.toUpperCase())} placeholder="KA" />;
    case "pincode":
      return <Input aria-label="Pincode" className="w-32" value={typeof condition.value === "string" ? condition.value : ""} onChange={(e) => onChange(e.target.value)} placeholder="560001" />;
    case "productId":
      return (
        <SimpleSelect
          ariaLabel="Product"
          className="w-56"
          value={typeof condition.value === "string" ? condition.value : "any"}
          options={[{ value: "any", label: "Choose a product…" }, ...(products.data?.items ?? []).map((p) => ({ value: p.id, label: p.title }))]}
          onChange={(v) => onChange(v === "any" ? "" : v)}
        />
      );
    case "collectionId":
      return (
        <SimpleSelect
          ariaLabel="Collection"
          className="w-56"
          value={typeof condition.value === "string" ? condition.value : "any"}
          options={[{ value: "any", label: "Choose a collection…" }, ...(collections.data ?? []).map((c) => ({ value: c.id, label: c.title }))]}
          onChange={(v) => onChange(v === "any" ? "" : v)}
        />
      );
    case "segment":
      return (
        <SimpleSelect
          ariaLabel="Segment"
          className="w-56"
          value={typeof condition.value === "string" ? condition.value : "any"}
          options={[{ value: "any", label: "Choose a segment…" }, ...(segments.data?.items ?? []).filter((s) => s.id !== condition.value).map((s) => ({ value: s.id, label: s.name }))]}
          onChange={(v) => onChange(v === "any" ? "" : v)}
        />
      );
    case "none":
    case "never":
      return <span className="text-sm text-muted-foreground">—</span>;
    default:
      return null;
  }
}

export interface ConditionsBuilderProps {
  rules: RuleSet;
  onChange: (rules: RuleSet) => void;
}

export function ConditionsBuilder({ rules, onChange }: ConditionsBuilderProps) {
  const setCondition = (index: number, patch: Partial<Condition>) => {
    onChange({ ...rules, conditions: rules.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  };

  const fieldOptions = ALL_FIELDS.map((f) => ({ value: f.id, label: `${f.group} · ${f.label}` }));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Customers who match</span>
        <SimpleSelect
          ariaLabel="Match mode"
          className="w-24"
          value={rules.match}
          options={[
            { value: "all", label: "all" },
            { value: "any", label: "any" },
          ]}
          onChange={(v) => onChange({ ...rules, match: v as "all" | "any" })}
        />
        <span className="text-muted-foreground">of these conditions:</span>
      </div>

      {rules.conditions.map((condition, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
          <SimpleSelect
            ariaLabel={`Condition ${index + 1} field`}
            className="w-64"
            value={condition.field}
            options={fieldOptions}
            onChange={(field) => {
              const op = opsForField(field)[0]?.[0] ?? "is";
              setCondition(index, { field, op, value: defaultValueFor(field, op) });
            }}
          />
          <SimpleSelect
            ariaLabel={`Condition ${index + 1} operator`}
            className="w-40"
            value={condition.op}
            options={opsForField(condition.field).map(([op, label]) => ({ value: op, label }))}
            onChange={(op) => setCondition(index, { op, value: defaultValueFor(condition.field, op) })}
          />
          <ValueEditor condition={condition} onChange={(value) => setCondition(index, { value })} />
          <Button variant="ghost" size="icon" aria-label={`Remove condition ${index + 1}`} onClick={() => onChange({ ...rules, conditions: rules.conditions.filter((_, i) => i !== index) })}>
            <Trash2 />
          </Button>
        </div>
      ))}

      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={rules.conditions.length >= 10}
          onClick={() => onChange({ ...rules, conditions: [...rules.conditions, { field: "orders_count", op: "gte", value: defaultValueFor("orders_count", "gte") }] })}
        >
          <Plus className="mr-1.5 size-3.5" aria-hidden /> Add condition
        </Button>
        {rules.conditions.length >= 10 ? <span className="ml-2 text-xs text-muted-foreground">A segment can have at most 10 conditions.</span> : null}
      </div>
    </div>
  );
}

/** The live preview panel: debounced count and the first 10 matches. */
export function ConditionsPreview({ rules }: { rules: RuleSet }) {
  const [debounced, setDebounced] = useState(() => normalizeRules(rules));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(normalizeRules(rules)), 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [rules]);

  const key = JSON.stringify(debounced);
  const preview = useQuery({
    queryKey: ["segments", "preview", key],
    queryFn: () => client.admin.segments.preview({ rules: JSON.parse(key) as RuleSet }),
    retry: false,
  });

  if (preview.isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        <p className="font-medium">Could not preview, try again</p>
        <p className="mt-1 text-xs">{errorMessage(preview.error)}</p>
      </div>
    );
  }
  if (preview.isLoading) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-3/4" />
      </div>
    );
  }
  const count = preview.data?.count ?? 0;
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium text-foreground">
        Matches <span className="tabular-nums">{count.toLocaleString("en-IN")}</span> customer{count === 1 ? "" : "s"}
      </p>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">No customers match yet.</p>
      ) : (
        <ul className="grid gap-1">
          {(preview.data?.sample ?? []).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-foreground">{s.name || "Unnamed"}</span>
              <span className="truncate text-muted-foreground">{s.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
