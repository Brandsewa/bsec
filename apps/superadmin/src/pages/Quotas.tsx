import React from "react";
import { useQuery } from "@tanstack/react-query";
import { } from "lucide-react";
import {
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
    <PageContainer size="full">
      <PageHeader
        title="Quotas & Resource Tiers"
        description="Ceiling definitions across tenant size tiers (XS, S, M, L) per PLAN §6.1. Resolved as tenant override → size tier → plan."
      />

      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="px-4">Quota Resource</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Tier XS</TableHead>
              <TableHead>Tier S</TableHead>
              <TableHead>Tier M</TableHead>
              <TableHead>Tier L</TableHead>
              <TableHead className="text-right px-4">Enforcement</TableHead>
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
                <TableRow key={q.key} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-mono text-xs font-semibold px-4 text-foreground">{q.key}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{q.description || "—"}</TableCell>
                  <TableCell className="text-xs font-medium">{q.tierXs.toLocaleString("en-IN")} {q.unit}</TableCell>
                  <TableCell className="text-xs font-medium">{q.tierS.toLocaleString("en-IN")} {q.unit}</TableCell>
                  <TableCell className="text-xs font-medium">{q.tierM.toLocaleString("en-IN")} {q.unit}</TableCell>
                  <TableCell className="text-xs font-medium">{q.tierL.toLocaleString("en-IN")} {q.unit}</TableCell>
                  <TableCell className="text-right px-4">
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
