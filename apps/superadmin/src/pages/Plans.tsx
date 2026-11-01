import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Pencil } from "lucide-react";
import { Button, PageContainer, PageHeader, PageSkeleton } from "@bs/ui";
import { formatMoney } from "@bs/contracts/money";
import { renderPlanBullet, type PlanEditorPlan } from "@bs/contracts";
import { client } from "../lib/orpc.ts";
import { useHasRole } from "../lib/user-context.tsx";
import { PlanEditDialog } from "./plans/PlanEditDialog.tsx";
import { CompareEditor } from "./plans/CompareEditor.tsx";

/** One plan card, laid out the way merchants see it on signup and in Plan and billing. */
function PlanCard({ plan, canEdit, onEdit }: { plan: PlanEditorPlan; canEdit: boolean; onEdit: () => void }) {
  const lines = plan.cardBullets.map((b) => renderPlanBullet(b, plan.limits)).filter((t): t is string => Boolean(t));
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-foreground">{plan.name}</h3>
            {plan.badge ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{plan.badge}</span> : null}
            {!plan.isPublic ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Hidden</span> : null}
          </div>
          {plan.tagline ? <p className="mt-0.5 text-xs text-primary/90">{plan.tagline}</p> : null}
          {plan.audience ? <p className="text-xs text-muted-foreground">{plan.audience}</p> : null}
        </div>
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={onEdit} aria-label={`Edit ${plan.name}`}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
          </Button>
        ) : null}
      </div>

      <div className="mt-4">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-foreground">{formatMoney(plan.priceMonthlyPaise, "INR")}</span>
          <span className="text-xs text-muted-foreground">/ month</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatMoney(plan.priceYearlyPaise, "INR")} billed yearly
          {plan.priceMonthlyUsdCents != null ? ` · ${formatMoney(plan.priceMonthlyUsdCents, "USD")} / month outside India` : " · not offered outside India"}
        </p>
      </div>

      <ul className="mt-4 flex-1 space-y-2 border-t border-border/60 pt-4 text-sm">
        {lines.length === 0 ? <li className="text-xs text-muted-foreground">No line items yet. Edit the plan to add some.</li> : null}
        {lines.map((t, i) => (
          <li key={i} className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span>{t}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <strong className="font-semibold text-foreground">{plan.activeSubscribersCount}</strong> active {plan.activeSubscribersCount === 1 ? "store" : "stores"} · code{" "}
        <span className="font-mono uppercase">{plan.code}</span> · size tier {plan.tier}
      </p>
    </div>
  );
}

export function Plans() {
  const canEdit = useHasRole("platform_admin");
  const [editing, setEditing] = useState<PlanEditorPlan | null>(null);
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({ queryKey: ["platform", "plan-editor"], queryFn: () => client.plans.editor() });

  if (isLoading || !data) return <PageSkeleton />;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Plans"
        description="What merchants see when they choose a plan. Edit the cards and the comparison table here; signup and Plan and billing show whatever is saved. Invoices are under Invoices and transactions."
      />

      <div className="space-y-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {data.plans.map((p) => (
            <PlanCard key={p.id} plan={p} canEdit={canEdit} onEdit={() => setEditing(p)} />
          ))}
        </div>

        {canEdit ? (
          <CompareEditor key={dataUpdatedAt} view={data} onSaved={() => void refetch()} />
        ) : (
          <p className="text-xs text-muted-foreground">Only platform admins can edit the comparison table.</p>
        )}
      </div>

      {editing ? (
        <PlanEditDialog
          plan={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
        />
      ) : null}
    </PageContainer>
  );
}
