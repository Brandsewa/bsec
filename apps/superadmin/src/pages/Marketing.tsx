import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { Button, EmptyState, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { client, orpc } from "../lib/orpc.ts";

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
      <PageHeader title="Marketing" description="Manage the bcom.si website." />
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
        <EmptyState icon={Globe} title="Website content is ready" description="Use Navigation and Blogs in the sidebar. Pages arrive here next." />
      )}
    </PageContainer>
  );
}
