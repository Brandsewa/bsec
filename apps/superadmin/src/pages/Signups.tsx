import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, } from "lucide-react";
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
    <PageContainer size="full">
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
        <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Contact Email</TableHead>
                <TableHead>Name / Business</TableHead>
                <TableHead>Desired Slug</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Funnel Step</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right px-4">Captured At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signups.map((s) => (
                <TableRow key={s.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-medium text-xs px-4 text-foreground">{s.email || "—"}</TableCell>
                  <TableCell className="text-xs">
                    <div className="font-medium text-foreground">{s.name || "—"}</div>
                    {s.businessName && <div className="text-muted-foreground text-[11px]">{s.businessName}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.desiredSlug ? `${s.desiredSlug}.bcom.si` : "—"}
                  </TableCell>
                  <TableCell className="text-xs capitalize font-medium">{s.industry || "—"}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-primary/10 text-primary">
                      {s.step}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.source || "organic"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground text-right px-4">
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
