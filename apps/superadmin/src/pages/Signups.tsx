import React from "react";
import { useQuery } from "@tanstack/react-query";
import { UserPlus, Users, ArrowRight } from "lucide-react";
import {
  EmptyState,
  PageContainer,
  PageHeader,
  PageSkeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bs/ui";
import { client } from "../lib/orpc.ts";

export function Signups() {
  const { data: signups, isLoading } = useQuery({
    queryKey: ["platform", "signups"],
    queryFn: () => client.signups.list({ limit: 100 }),
  });

  if (isLoading) return <PageSkeleton />;

  return (
    <PageContainer>
      <PageHeader
        title="Signups Funnel & Leads"
        description="Prospective merchants engaging with the self-signup flow, tracked by progression step."
      />

      {!signups || signups.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No signup leads recorded yet"
          description="Inbound leads from public self-signup will appear here in real time."
        />
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact Email</TableHead>
                <TableHead>Name / Business</TableHead>
                <TableHead>Desired Slug</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Funnel Step</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Captured At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signups.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium text-xs">{s.email || "—"}</TableCell>
                  <TableCell className="text-xs">
                    <div>{s.name || "—"}</div>
                    {s.businessName && <div className="text-muted-foreground text-[11px]">{s.businessName}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.desiredSlug ? `${s.desiredSlug}.gobs.cloud` : "—"}
                  </TableCell>
                  <TableCell className="text-xs capitalize">{s.industry || "—"}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-primary/10 text-primary">
                      {s.step}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.source || "organic"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(s.createdAt).toLocaleString("en-IN")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageContainer>
  );
}
