import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BlockEditor } from "@bs/block-editor";
import type { BlockInstance } from "@bs/blocks";
import { Button, EmptyState, PageContainer, PageSkeleton } from "@bs/ui";
import { client, orpc } from "../../lib/orpc.ts";
import { storeHost, themeVarsFor } from "./host.ts";

/**
 * Visual editor for one page. Edits a draft (saved as a new page version); Publish makes that
 * version live and refreshes the storefront cache. Permissions are enforced by the API, and the
 * Publish button is hidden for staff who can edit but not publish.
 */
export default function PageVisualEditor({ pageId, canPublish }: { pageId: string; canPublish: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pageQuery = useQuery(orpc.admin.pages.get.queryOptions({ input: { id: pageId, draft: true } }));
  const brandQuery = useQuery(orpc.admin.branding.get.queryOptions());
  const themeQuery = useQuery(orpc.admin.themes.get.queryOptions());

  const themeVars = useMemo(() => themeVarsFor(brandQuery.data, themeQuery.data), [brandQuery.data, themeQuery.data]);
  const exit = () => void navigate({ to: "/online-store/pages" });

  if (pageQuery.isError) {
    return (
      <PageContainer size="small">
        <EmptyState
          title="Could not load this page"
          description={pageQuery.error.message}
          action={<Button onClick={exit}>Back to pages</Button>}
        />
      </PageContainer>
    );
  }
  // Branding/theme only style the canvas: wait for them to settle, but never block editing if they fail.
  const stylingSettled = !brandQuery.isPending && !themeQuery.isPending;
  if (!pageQuery.data || !stylingSettled) return <PageSkeleton />;

  const page = pageQuery.data;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.pages.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.pages.get.key({ input: { id: pageId } }) }),
    ]);

  const saveDraft = async (blocks: BlockInstance[]) => {
    await client.admin.pages.saveDraft({ id: pageId, blocks });
    await refresh();
  };

  return (
    <BlockEditor
      title={`Editing: ${page.title}`}
      initialBlocks={page.blocks as BlockInstance[]}
      host={storeHost}
      themeVars={themeVars}
      onSaveDraft={saveDraft}
      onPublish={async (blocks) => {
        if (!canPublish) throw new Error("You do not have permission to publish. Save the draft and ask a store owner.");
        // Publish exactly what is on the canvas: save it as a new version, then point the page at it.
        const { versionId } = await client.admin.pages.saveDraft({ id: pageId, blocks });
        await client.admin.pages.publish({ id: pageId, versionId });
        await refresh();
      }}
      onExit={exit}
      publishLabel={page.hasUnpublishedChanges ? "Draft differs from live page" : undefined}
    />
  );
}
