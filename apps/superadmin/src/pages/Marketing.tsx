import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Eye, Globe, Search, ShieldCheck } from "lucide-react";
import { Button, EmptyState, PageContainer, PageSkeleton, SimpleSelect, toast } from "@bs/ui";
import { client, orpc } from "../lib/orpc.ts";

const SECTIONS = [
  { to: "/storefront/settings/visibility", icon: Eye, title: "Website visibility" },
  { to: "/storefront/settings/search", icon: Search, title: "Search engines" },
  { to: "/storefront/settings/privacy", icon: ShieldCheck, title: "Customer privacy" },
] as const;

/**
 * The website's Settings workspace, laid out like the store admin's: a section list on the left (a chooser on small
 * screens) and the selected section on the right. bcom.si's content lives under one internal record, which is created
 * here the first time (ADR-042).
 */
export function SettingsShell({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const status = useQuery(orpc.marketing.status.queryOptions());
  const enable = useMutation({
    mutationFn: () => client.marketing.enable(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: orpc.marketing.status.key() });
      toast.success("Website content is set up");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (status.isLoading) return <PageSkeleton />;
  const data = status.data;
  if (!data?.contentConnected || !data.siteId) {
    return (
      <PageContainer size="small">
        {!data?.contentConnected ? (
          <EmptyState icon={Globe} title="Not connected yet" description="The Platform service needs DATABASE_URL_RW before website content can be managed." />
        ) : (
          <EmptyState
            icon={Globe}
            title="Set up website content"
            description="Creates the internal record that holds bcom.si's pages, navigation and blog. It is not a store and never appears in store lists."
            action={<Button onClick={() => enable.mutate()} disabled={enable.isPending}>Set up</Button>}
          />
        )}
      </PageContainer>
    );
  }
  const active = SECTIONS.find((s) => pathname.startsWith(s.to));
  return (
    <div className="flex min-h-[calc(100vh-3rem)] w-full flex-col lg:flex-row">
      <div className="border-b border-border bg-background p-4 lg:hidden">
        <SimpleSelect
          ariaLabel="Settings section"
          value={active?.to ?? ""}
          onChange={(to) => void navigate({ to })}
          options={SECTIONS.map((s) => ({ value: s.to, label: s.title }))}
        />
      </div>
      <aside aria-label="Settings navigation" className="hidden lg:flex lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-border lg:bg-background">
        <div className="sticky top-0 flex flex-col px-3 py-5">
          <h1 className="mb-2 px-2.5 text-xs font-semibold tracking-tight text-foreground">Website settings</h1>
          <nav aria-label="Website settings" className="flex flex-col gap-0.5">
            {SECTIONS.map((s) => {
              const isActive = s.to === active?.to;
              return (
                <Link
                  key={s.to}
                  to={s.to}
                  aria-current={isActive ? "page" : undefined}
                  className={`group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] leading-4 transition-colors ${isActive ? "bg-accent font-medium text-accent-foreground" : "font-normal text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
                >
                  <s.icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{s.title}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>
      <div className="min-w-0 flex-1 p-4 lg:p-8">
        <div className="mx-auto max-w-3xl">{children}</div>
      </div>
    </div>
  );
}
