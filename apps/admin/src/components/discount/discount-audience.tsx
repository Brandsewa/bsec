import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, X } from "lucide-react";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, FieldDescription, FieldGroup, FieldLabel, Input, SimpleSelect, toast } from "@bs/ui";
import type { DiscountEligibility } from "@bs/contracts/discount-rules";
import { orpc, client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

export interface PickedCustomer {
  id: string;
  name: string;
  email: string;
}

export interface AudienceState {
  type: DiscountEligibility["type"];
  /** Comma-separated tags. */
  tags: string;
  customers: PickedCustomer[];
}

export const emptyAudience: AudienceState = { type: "all", tags: "", customers: [] };

const splitTags = (raw: string) => [...new Set(raw.split(",").map((t) => t.trim()).filter(Boolean))];

export function audienceFromDiscount(d: { customerEligibility: DiscountEligibility; eligibleCustomers?: PickedCustomer[] | undefined }): AudienceState {
  const a = d.customerEligibility;
  return {
    type: a.type,
    tags: a.type === "tags" ? a.tags.join(", ") : "",
    customers: a.type === "customers" ? (d.eligibleCustomers ?? []) : [],
  };
}

export function audienceValid(a: AudienceState): boolean {
  if (a.type === "tags") return splitTags(a.tags).length > 0;
  if (a.type === "customers") return a.customers.length > 0;
  return true;
}

export function audienceToApi(a: AudienceState): DiscountEligibility {
  if (a.type === "tags") return { type: "tags", tags: splitTags(a.tags) };
  if (a.type === "customers") return { type: "customers", customerIds: a.customers.map((c) => c.id) };
  return a.type === "new_customers" ? { type: "new_customers" } : { type: "all" };
}

/** Who can use the discount. Anything but everyone needs a code, so the card says so instead of letting a save fail. */
export function DiscountAudienceCard({ audience, onChange, hasCode }: { audience: AudienceState; onChange: (next: AudienceState) => void; hasCode: boolean }) {
  const [search, setSearch] = useState("");
  const set = (patch: Partial<AudienceState>) => onChange({ ...audience, ...patch });
  const found = useQuery({
    ...orpc.admin.customers.list.queryOptions({ input: { search, limit: 6 } }),
    enabled: audience.type === "customers" && search.trim().length >= 2,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Who can use it</CardTitle>
        <CardDescription>Limit the discount to some customers. They still enter the code; the store checks who they are when they order.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="discount-audience">Customers</FieldLabel>
            <SimpleSelect
              id="discount-audience"
              value={audience.type}
              onChange={(v) => set({ type: v as AudienceState["type"] })}
              options={[
                { value: "all", label: "Everyone" },
                { value: "new_customers", label: "New customers (no order yet)" },
                { value: "tags", label: "Customers with a tag" },
                { value: "customers", label: "Specific customers" },
              ]}
            />
          </Field>
          {audience.type !== "all" && !hasCode ? <Alert>A discount for some customers needs a code (or a list of codes), so only they can use it.</Alert> : null}
          {audience.type === "tags" ? (
            <Field>
              <FieldLabel htmlFor="discount-audience-tags">Tags</FieldLabel>
              <Input id="discount-audience-tags" value={audience.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="vip, wholesale" />
              <FieldDescription>Separate tags with commas. A customer with any one of them can use the code.</FieldDescription>
            </Field>
          ) : null}
          {audience.type === "customers" ? (
            <Field>
              <FieldLabel htmlFor="discount-audience-search">Customers ({audience.customers.length})</FieldLabel>
              <Input id="discount-audience-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email or phone" />
              {(found.data?.items ?? []).length > 0 ? (
                <ul className="grid gap-1">
                  {(found.data?.items ?? [])
                    .filter((c) => !audience.customers.some((x) => x.id === c.id))
                    .map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/40"
                          onClick={() => {
                            set({ customers: [...audience.customers, { id: c.id, name: c.name, email: c.email }] });
                            setSearch("");
                          }}
                        >
                          <span className="truncate">{c.name || c.email}</span>
                          <span className="truncate text-muted-foreground">{c.email}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              ) : null}
              {audience.customers.length > 0 ? (
                <ul className="grid gap-1">
                  {audience.customers.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
                      <span className="truncate">{c.name || c.email}</span>
                      <button type="button" aria-label={`Remove ${c.name || c.email}`} className="text-muted-foreground hover:text-foreground" onClick={() => set({ customers: audience.customers.filter((x) => x.id !== c.id) })}>
                        <X className="size-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <FieldDescription>Type at least two letters to find a customer.</FieldDescription>
              )}
            </Field>
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

/** Generate, see and export the single-use codes of a discount made for a list of them. */
export function CodeListPanel({ discountId }: { discountId: string }) {
  const queryClient = useQueryClient();
  const [count, setCount] = useState("50");
  const [prefix, setPrefix] = useState("");
  const [filter, setFilter] = useState<"all" | "used" | "unused">("all");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const list = useQuery(orpc.admin.discounts.codes.list.queryOptions({ input: { id: discountId, filter, ...(search.trim() ? { search: search.trim() } : {}), limit: 100 } }));
  const generate = useMutation(
    orpc.admin.discounts.codes.generate.mutationOptions({
      onSuccess: (res) => {
        toast.success(`${res.created} codes created.`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.discounts.codes.key() });
      },
    }),
  );

  const n = Number(count);
  const countOk = Number.isInteger(n) && n >= 1 && n <= 5000;

  async function exportCsv() {
    setExporting(true);
    try {
      const all = await client.admin.discounts.codes.list({ id: discountId, filter, limit: 5000, offset: 0 });
      const lines = ["code,status,used_at", ...all.items.map((c) => `${c.code},${c.usedAt ? "used" : "unused"},${c.usedAt ?? ""}`)];
      const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "discount-codes.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Single-use codes</CardTitle>
        <CardDescription>
          {list.data ? `${list.data.codeCount} codes, ${list.data.usedCount} used.` : "Each code works once."} Share them with influencers, in emails or campaigns.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field>
              <FieldLabel htmlFor="codes-count">How many</FieldLabel>
              <Input id="codes-count" type="number" min={1} max={5000} step="1" value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="codes-prefix">Prefix (optional)</FieldLabel>
              <Input id="codes-prefix" className="font-mono uppercase" maxLength={12} value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} placeholder="DIWALI-" />
            </Field>
            <Button type="button" disabled={!countOk || generate.isPending} onClick={() => generate.mutate({ id: discountId, count: n, ...(prefix ? { prefix } : {}) })}>
              {generate.isPending ? "Creating…" : "Create codes"}
            </Button>
          </div>
          {generate.isError ? <Alert variant="destructive">{errorMessage(generate.error)}</Alert> : null}

          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field>
              <FieldLabel htmlFor="codes-search">Find a code</FieldLabel>
              <Input id="codes-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search codes" />
            </Field>
            <SimpleSelect
              id="codes-filter"
              value={filter}
              onChange={(v) => setFilter(v as typeof filter)}
              options={[
                { value: "all", label: "All codes" },
                { value: "unused", label: "Unused" },
                { value: "used", label: "Used" },
              ]}
            />
            <Button type="button" variant="outline" disabled={exporting || !list.data?.codeCount} onClick={() => void exportCsv()}>
              <Download className="size-4" aria-hidden /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>

          {list.isLoading ? (
            <FieldDescription>Loading codes…</FieldDescription>
          ) : (list.data?.items ?? []).length === 0 ? (
            <FieldDescription>No codes yet.</FieldDescription>
          ) : (
            <ul className="grid max-h-72 gap-1 overflow-y-auto">
              {(list.data?.items ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
                  <span className="font-mono">{c.code}</span>
                  <span className="text-muted-foreground">{c.usedAt ? `Used ${new Date(c.usedAt).toLocaleDateString()}` : "Unused"}</span>
                </li>
              ))}
            </ul>
          )}
          {list.data && list.data.total > list.data.items.length ? <FieldDescription>Showing the first {list.data.items.length} of {list.data.total}. Export for the full list.</FieldDescription> : null}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
