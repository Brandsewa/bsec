import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { PageBreadcrumbs, PageContainer, PageSkeleton, toast } from "@bs/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "../../components/field.tsx";
import { SectionCard } from "../../components/section-card.tsx";
import { useUnsavedGuard } from "../../components/settings/settings-page.tsx";
import { ConditionsBuilder, ConditionsPreview, type RuleSet } from "../../components/segments/conditions-builder.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/segments_/new")({
  pendingComponent: () => <PageSkeleton />,
  component: SegmentNewPage,
});

function SegmentNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"manual" | "automatic">("automatic");
  const [rules, setRules] = useState<RuleSet>({
    match: "all",
    conditions: [{ field: "orders_count", op: "gte", value: 1 }],
  });
  const [saving, setSaving] = useState(false);
  const dirty = Boolean(name.trim() || description.trim() || saving);
  useUnsavedGuard(dirty && !saving);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Give the segment a name first.");
      return;
    }
    setSaving(true);
    try {
      const created = await client.admin.segments.create({
        name: name.trim(),
        description: description.trim() || undefined,
        kind,
        rules: kind === "automatic" ? rules : undefined,
      });
      toast.success(`Segment "${created.name}" created.`);
      queryClient.invalidateQueries({ queryKey: orpc.admin.segments.key() });
      void navigate({ to: "/segments/$segmentId", params: { segmentId: created.id }, search: { edit: 1 } });
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <PageContainer size="full">
      <PageBreadcrumbs items={[{ label: "Segments", href: "/segments" }, { label: "New" }]} />
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3">
        <Button variant="ghost" size="icon" aria-label="Back to segments" render={<Link to="/segments" />}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-foreground">New segment</h1>
          <p className="truncate text-xs text-muted-foreground">Grouping and export only — nothing is sent from here.</p>
        </div>
        <Button size="sm" disabled={saving || !name.trim()} onClick={() => void save()}>
          Save segment
        </Button>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-4">
          <SectionCard title="Details">
            <div className="grid gap-3">
              <Field id="seg-name" label="Name">
                <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VIP customers" maxLength={100} />
              </Field>
              <Field id="seg-desc" label="Description (optional)">
                <Input id="seg-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this segment for?" maxLength={200} />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Type" description="The type is locked once the segment is saved.">
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  { id: "automatic", title: "Automatic", hint: "Customers who match your conditions, always up to date." },
                  { id: "manual", title: "Manual", hint: "You choose the customers." },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={kind === option.id}
                  onClick={() => setKind(option.id)}
                  className={`rounded-md border p-3 text-left transition-colors ${kind === option.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}
                >
                  <p className="text-sm font-medium text-foreground">{option.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{option.hint}</p>
                </button>
              ))}
            </div>
          </SectionCard>

          {kind === "automatic" ? (
            <SectionCard title="Conditions">
              <div className="grid gap-4">
                <ConditionsBuilder rules={rules} onChange={setRules} />
                <div className="rounded-md border border-border p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Live preview</p>
                  <ConditionsPreview rules={rules} />
                </div>
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="Members" description="Save the segment first; then add customers on the next screen by search or by pasting emails.">
              <p className="text-sm text-muted-foreground">No members yet — this segment starts empty.</p>
            </SectionCard>
          )}
        </div>

        <div className="grid gap-4">
          <SectionCard title="Summary">
            <div className="grid gap-1.5 text-sm">
              <p className="text-muted-foreground">
                Type: <span className="text-foreground">{kind === "automatic" ? "Automatic" : "Manual"}</span>
              </p>
              {kind === "automatic" ? (
                <p className="text-muted-foreground">
                  Conditions: <span className="text-foreground">{rules.conditions.length}</span>
                </p>
              ) : null}
            </div>
          </SectionCard>
        </div>
      </div>
    </PageContainer>
  );
}
export default SegmentNewPage;
