import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Globe, RefreshCw, } from "lucide-react";
import {
  Button,
  EmptyState,
  Input,
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

export function Domains() {
  const [search, setSearch] = useState("");

  const { data: domains, isLoading, refetch } = useQuery({
    queryKey: ["platform", "domains", { search }],
    queryFn: () => client.domains.list({ search: search.trim() || undefined }),
  });

  if (isLoading) return <PageSkeleton />;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Custom Domains & Hostnames"
        description="All platform subdomains and Cloudflare for SaaS custom hostnames mapped across stores."
        aside={
          <Button size="sm" variant="default" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Filter by hostname or tenant..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-xs h-9"
        />
      </div>

      {!domains || domains.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No domains found"
          description="Custom domains will appear here once connected by stores or during provisioning."
        />
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Hostname</TableHead>
                <TableHead>Store / Tenant</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Primary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>SSL Status</TableHead>
                <TableHead>Failure / DNS Reason</TableHead>
                <TableHead className="text-right px-4">Connected At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {domains.map((d) => (
                <TableRow key={d.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-mono text-xs font-semibold px-4 text-foreground">{d.hostname}</TableCell>
                  <TableCell>
                    {d.tenantSlug ? (
                      <Link
                        to={`/tenants/${d.tenantId}`}
                        className="text-xs text-primary hover:underline font-medium"
                      >
                        {d.tenantName || d.tenantSlug}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">{d.tenantId}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{d.type}</TableCell>
                  <TableCell className="text-xs">{d.isPrimary ? "Yes" : "No"}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 capitalize">
                      {d.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs capitalize font-medium">{d.sslStatus || "pending"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {d.failureReason || "DNS verified"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground text-right px-4">
                    {new Date(d.createdAt).toLocaleDateString("en-IN")}
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
