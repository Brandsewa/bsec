import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers, Palette, CheckCircle2 } from "lucide-react";
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

export function Templates() {
  const { data: templates, isLoading } = useQuery({
    queryKey: ["platform", "templates"],
    queryFn: () => client.templates.list(),
  });

  if (isLoading) return <PageSkeleton />;

  return (
    <PageContainer>
      <PageHeader
        title="Theme Templates & Block Registry"
        description="Pre-built themes and versioned block definitions available for store creation."
      />

      <div className="rounded-xl border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Template Name</TableHead>
              <TableHead>Code Identifier</TableHead>
              <TableHead>Target Industry</TableHead>
              <TableHead>Schema Version</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(!templates || templates.length === 0) ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-xs text-muted-foreground">
                  No theme templates found in database.
                </TableCell>
              </TableRow>
            ) : (
              templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-semibold text-xs">{t.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{t.code}</TableCell>
                  <TableCell className="text-xs capitalize">{t.industry}</TableCell>
                  <TableCell className="text-xs font-mono">v{t.version}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      t.isActive
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {t.isActive ? "Active" : "Inactive"}
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
