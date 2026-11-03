import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BlockEditor, type BlockEditorHost } from "@bs/block-editor";
import type { BlockInstance } from "@bs/blocks";
import { Button, EmptyState, PageContainer, PageSkeleton } from "@bs/ui";
import { client, orpc } from "@bs/content-admin/host.ts";

/** Website sections have no store data, menus or collections to load. */
const host: BlockEditorHost = {
  loadRenderData: () => Promise.resolve({ data: {}, media: {} }),
  listMenus: () => Promise.resolve([]),
  listCollections: () => Promise.resolve([]),
  listCategories: () => Promise.resolve([]),
};

const THEME_VARS = {};

/** Visual editor for one page of bcom.si. Same draft and publish flow as a store page, offering only website sections. */
export default function MarketingPageEditor({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pageQuery = useQuery(orpc.admin.pages.get.queryOptions({ input: { id, draft: true } }));
  const exit = () => void navigate({ to: "/marketing/pages" });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.pages.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.pages.get.key({ input: { id } }) }),
    ]);
  const page = pageQuery.data;
  const previewHref = useMemo(() => (page ? (page.slug === "about" ? "/about" : `/pages/${page.slug}`) : undefined), [page]);

  if (pageQuery.isError) {
    return (
      <PageContainer size="small">
        <EmptyState title="Could not load this page" description={pageQuery.error.message} action={<Button onClick={exit}>Back to pages</Button>} />
      </PageContainer>
    );
  }
  if (!page) return <PageSkeleton />;

  return (
    <BlockEditor
      title={`Editing: ${page.title}`}
      initialBlocks={page.blocks as BlockInstance[]}
      host={host}
      themeVars={THEME_VARS}
      pageKind="marketing"
      previewHref={previewHref ? `${import.meta.env.VITE_MARKETING_URL ?? "https://bcom.si"}${previewHref}` : undefined}
      onSaveDraft={async (blocks) => {
        await client.admin.pages.saveDraft({ id, blocks });
        await refresh();
      }}
      onPublish={async (blocks) => {
        const { versionId } = await client.admin.pages.saveDraft({ id, blocks });
        await client.admin.pages.publish({ id, versionId });
        await refresh();
      }}
      onExit={exit}
      publishLabel={page.hasUnpublishedChanges ? "Draft differs from live page" : undefined}
    />
  );
}
