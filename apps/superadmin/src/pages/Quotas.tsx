import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sliders, ShieldAlert, CheckCircle2 } from "lucide-react";
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

export function Quotas() {
  const { data: quotas, isLoading } = useQuery({
    queryKey: ["platform", "quotas"],
    queryFn: () => client.quotas.list(),
  });

  if (isLoading) return <PageSkeleton />;

  return (
    <PageContainer>
      <PageHeader
        title="Quotas & Resource Tiers"
        description="Ceiling definitions across tenant size tiers (XS, S, M, L) per PLAN §6.1. Resolved as tenant override → size tier → plan."
      />

      <div className="rounded-xl border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quota Resource</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Tier XS</TableHead>
              <TableHead>Tier S</TableHead>
              <TableHead>Tier M</TableHead>
              <TableHead>Tier L</TableHead>
              <TableHead>Enforcement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(!quotas || quotas.length === 0) ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-6 text-xs text-muted-foreground">
                  No quota definitions found in database.
                </TableCell>
              </TableRow>
            ) : (
              quotas.map((q) => (
                <TableRow key={q.key}>
                  <TableCell className="font-mono text-xs font-semibold">{q.key}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{q.description || "—"}</TableCell>
                  <TableCell className="text-xs font-medium">{q.tierXs.toLocaleString("en-IN")} {q.unit}</TableCell>
                  <TableCell className="text-xs font-medium">{q.tierS.toLocaleString("en-IN")} {q.unit}</TableCell>
                  <TableCell className="text-xs font-medium">{q.tierM.toLocaleString("en-IN")} {q.unit}</TableCell>
                  <TableCell className="text-xs font-medium">{q.tierL.toLocaleString("en-IN")} {q.unit}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      q.enforcement === "hard"
                        ? "bg-red-500/10 text-red-700 dark:text-red-400 font-semibold"
                        : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                    }`}>
                      {q.enforcement}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </PageContainer>
  );
}
