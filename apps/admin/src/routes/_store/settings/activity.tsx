import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Clock, History } from "lucide-react";
import { EmptyState, PageSkeleton } from "@bs/ui";
import { Button } from "@bs/ui";
import { DataTable, type Column } from "../../../components/data-table/data-table.tsx";
import { Pagination } from "../../../components/data-table/pagination.tsx";
import { SettingsCard, SettingsPageFrame } from "../../../components/settings/settings-page.tsx";
import { SimpleSelect } from "@bs/ui";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import type { SettingsActivityItem } from "@bs/contracts";

export const Route = createFileRoute("/_store/settings/activity")({
  pendingComponent: () => <PageSkeleton />,
  component: SettingsActivityPage,
});

const TITLE = "Settings Activity";
const DESCRIPTION = "Audit history of settings and configuration changes made to this store.";

const AREA_OPTIONS = [
  { value: "all", label: "All areas" },
  { value: "Store details", label: "Store details" },
  { value: "Orders", label: "Orders" },
  { value: "Returns", label: "Returns" },
  { value: "Storefront", label: "Storefront" },
  { value: "Checkout", label: "Checkout" },
  { value: "Customer accounts", label: "Customer accounts" },
  { value: "Notifications", label: "Notifications" },
  { value: "Policies", label: "Policies" },
  { value: "Customer privacy", label: "Customer privacy" },
  { value: "Plan & billing", label: "Plan & billing" },
  { value: "Branding", label: "Branding" },
  { value: "Shipping", label: "Shipping" },
  { value: "Taxes", label: "Taxes" },
  { value: "Payments", label: "Payments" },
  { value: "Domains", label: "Domains" },
  { value: "Users", label: "Users" },
  { value: "Support access", label: "Support access" },
];

export function SettingsActivityPage() {
  const [area, setArea] = useState<string>("all");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const queryInput = {
    area: area === "all" ? undefined : area,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const activityQuery = useQuery(orpc.admin.settingsActivity.list.queryOptions({ input: queryInput }));

  const items = activityQuery.data?.items ?? [];
  const total = activityQuery.data?.total ?? 0;

  const columns: Column<SettingsActivityItem>[] = [
    {
      id: "area",
      header: "Area",
      cell: (row) => (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
          {row.area}
        </span>
      ),
    },
    {
      id: "action",
      header: "Action",
      cell: (row) => (
        <div className="grid gap-0.5">
          <span className="font-mono text-xs text-foreground">{row.action}</span>
          <span className="text-[11px] text-muted-foreground">Target: {row.targetType}</span>
        </div>
      ),
    },
    {
      id: "actor",
      header: "Actor",
      cell: (row) => (
        <div className="grid gap-0.5">
          <span className="text-xs text-foreground">{row.actorEmail ?? row.actorType}</span>
          {row.actorId && !row.actorEmail ? <span className="font-mono text-[10px] text-muted-foreground">{row.actorId}</span> : null}
        </div>
      ),
    },
    {
      id: "createdAt",
      header: "Date",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ),
    },
    {
      id: "diff",
      header: "Changes",
      cell: (row) => {
        const hasDiff = row.diff && Object.keys(row.diff).length > 0;
        if (!hasDiff || !row.diff) return <span className="text-xs text-muted-foreground">—</span>;
        const diff = row.diff;
        const isExpanded = expandedId === row.id;
        return (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setExpandedId(isExpanded ? null : row.id)}
            >
              {isExpanded ? "Hide details" : `${Object.keys(diff).length} field(s)`}
            </Button>
            {isExpanded ? (
              <div className="mt-2 max-w-md rounded border border-border bg-muted/40 p-2 font-mono text-[11px]">
                {Object.entries(diff).map(([k, v]) => (
                  <div key={k} className="border-b border-border/50 py-1 last:border-0">
                    <span className="font-semibold text-foreground">{k}:</span>{" "}
                    <span className="text-muted-foreground">{JSON.stringify(v.before)}</span>
                    <span className="mx-1 text-foreground">→</span>
                    <span className="text-foreground">{JSON.stringify(v.after)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      },
    },
  ];

  if (activityQuery.isError) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load settings activity"
            description={errorMessage(activityQuery.error)}
            action={<Button onClick={() => void activityQuery.refetch()}>Try again</Button>}
          />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      <SettingsCard
        title="Activity audit trail"
        description="Immutable record of administrative mutations with before/after changes"
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground">Filter area:</span>
              <SimpleSelect
                ariaLabel="Filter settings area"
                className="w-44"
                value={area}
                options={AREA_OPTIONS}
                onChange={(val) => {
                  setArea(val);
                  setPage(1);
                }}
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>Immutable audit trail</span>
            </div>
          </div>

          <DataTable
            columns={columns}
            rows={items}
            getRowId={(r) => r.id}
            isLoading={activityQuery.isLoading}
            isFetching={activityQuery.isFetching}
            empty={
              <EmptyState
                icon={History}
                title="No activity recorded"
                description={
                  area === "all"
                    ? "Changes to store settings, policies, and roles will appear here."
                    : `No changes recorded for ${area} yet.`
                }
              />
            }
          />

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(newSize) => {
              setPageSize(newSize);
              setPage(1);
            }}
            disabled={activityQuery.isLoading || activityQuery.isFetching}
          />
        </div>
      </SettingsCard>
    </SettingsPageFrame>
  );
}
