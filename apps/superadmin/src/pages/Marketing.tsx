import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Eye, Globe, ScrollText, Search, ShieldCheck } from "lucide-react";
import { Button, EmptyState, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { client, orpc } from "../lib/orpc.ts";

const SECTIONS = [
  { to: "/storefront/settings/visibility", icon: Eye, title: "Website visibility", text: "Live, coming soon or maintenance for the public website. Signup and login are never affected." },
  { to: "/storefront/settings/search", icon: Search, title: "Search engines", text: "Ask Google and others not to list the site." },
  { to: "/storefront/settings/policies", icon: ScrollText, title: "Policies", text: "Terms, privacy, refund and delivery pages with drafts and history." },
  { to: "/storefront/settings/privacy", icon: ShieldCheck, title: "Customer privacy", text: "Privacy contact, grievance officer and request handling." },
] as const;

/** Start of the Marketing section: bcom.si's content lives under one internal record, which is created here (ADR-042). */
export function Marketing() {
  const qc = useQueryClient();
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
  return (
    <PageContainer>
      <PageHeader title="Settings" description="Settings for the bcom.si website." />
      {!data?.contentConnected ? (
        <EmptyState icon={Globe} title="Not connected yet" description="The Platform service needs DATABASE_URL_RW before website content can be managed." />
      ) : !data.siteId ? (
        <EmptyState
          icon={Globe}
          title="Set up website content"
          description="Creates the internal record that holds bcom.si's pages, navigation and blog. It is not a store and never appears in store lists."
          action={<Button onClick={() => enable.mutate()} disabled={enable.isPending}>Set up</Button>}
        />
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="Website settings">
          {SECTIONS.map((x) => (
            <Link key={x.to} to={x.to} className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/30">
              <x.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{x.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{x.text}</span>
              </span>
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
