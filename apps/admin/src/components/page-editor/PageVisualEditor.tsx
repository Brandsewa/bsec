import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BlockEditor, type EditorPageKind, type ThemeTokens } from "@bs/block-editor";
import { googleFontsHref, type BlockInstance } from "@bs/blocks";
import { Button, EmptyState, PageContainer, PageSkeleton } from "@bs/ui";
import { client, orpc } from "../../lib/orpc.ts";
import { storeHost, themeVarsFor } from "./host.ts";

/**
 * Visual editor for one page. Edits a draft (saved as a new page version); Publish makes that
 * version live and refreshes the storefront cache. Permissions are enforced by the API, and the
 * Publish button is hidden for staff who can edit but not publish.
 */
export default function PageVisualEditor({ pageId, canPublish, storeName }: { pageId: string; canPublish: boolean; storeName?: string | undefined }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pageQuery = useQuery(orpc.admin.pages.get.queryOptions({ input: { id: pageId, draft: true } }));
  const brandQuery = useQuery(orpc.admin.branding.get.queryOptions());
  const themeQuery = useQuery(orpc.admin.themes.get.queryOptions());
  const pagesListQuery = useQuery(orpc.admin.pages.list.queryOptions());

  // Theme settings edited from the sidebar's Theme tab. They go live when the page is published (like the
  // separate Theme settings screen, they have no draft), so they are held here until then.
  const [editedTokens, setEditedTokens] = useState<ThemeTokens | null>(null);
  const tokens = editedTokens ?? ((themeQuery.data?.tokens ?? null) as ThemeTokens | null);
  const themeVars = useMemo(
    () => themeVarsFor(brandQuery.data, themeQuery.data && tokens ? { ...themeQuery.data, tokens } : themeQuery.data),
    [brandQuery.data, themeQuery.data, tokens],
  );
  const pageType = pageQuery.data?.type ?? "custom";
  const kind: EditorPageKind =
    pageType === "home" ? "home" : pageType === "collection_template" ? "collection" : pageType === "product_template" ? "product" : pageType === "cart_template" ? "cart" : pageType === "header" ? "header" : pageType === "footer" ? "footer" : "custom";
  // Theme pages (header, footer, product, collection) are reached from the theme screen, not the Pages list.
  const exit = () => void navigate({ to: kind === "header" || kind === "footer" || kind === "product" || kind === "collection" || kind === "cart" ? "/online-store/theme-library" : "/online-store/pages" });
  const fontsHref = googleFontsHref((tokens ?? null) as never);

  const pageSwitcherOptions = useMemo(() => {
    const list = pagesListQuery.data ?? [];
    if (list.length === 0) return undefined;

    const systemDefs: Array<{ type: string; defaultLabel: string }> = [
      { type: "header", defaultLabel: "Header" },
      { type: "home", defaultLabel: "Home page" },
      { type: "collection_template", defaultLabel: "Collection template" },
      { type: "product_template", defaultLabel: "Product template" },
      { type: "cart_template", defaultLabel: "Cart template" },
      { type: "footer", defaultLabel: "Footer" },
    ];

    const options: Array<{ value: string; label: string }> = [];
    const usedIds = new Set<string>();

    for (const sys of systemDefs) {
      const match = list.find((p) => (sys.type === "home" ? p.type === "home" || p.slug === "home" : p.type === sys.type));
      if (match) {
        options.push({ value: match.id, label: match.title || sys.defaultLabel });
        usedIds.add(match.id);
      }
    }

    for (const p of list) {
      if (!usedIds.has(p.id) && !p.slug.startsWith("template-")) {
        options.push({ value: p.id, label: p.title || p.slug });
      }
    }

    return options.length > 0 ? options : undefined;
  }, [pagesListQuery.data]);

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
      storeName={storeName}
      pageKind={kind}
      fontsHref={fontsHref}
      pages={
        pageSwitcherOptions
          ? {
              value: pageId,
              options: pageSwitcherOptions,
              onChange: (newPageId) => void navigate({ to: "/online-store/editor/$pageId", params: { pageId: newPageId } }),
            }
          : undefined
      }
      onSaveDraft={saveDraft}
      onPublish={async (blocks) => {
        if (!canPublish) throw new Error("You do not have permission to publish. Save the draft and ask a store owner.");
        // Publish exactly what is on the canvas: save it as a new version, then point the page at it.
        const { versionId } = await client.admin.pages.saveDraft({ id: pageId, blocks });
        await client.admin.pages.publish({ id: pageId, versionId });
        if (editedTokens) {
          await client.admin.themes.update({ tokens: editedTokens });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: orpc.admin.themes.get.key() }),
            queryClient.invalidateQueries({ queryKey: orpc.admin.themes.library.key() }),
          ]);
          setEditedTokens(null);
        }
        await refresh();
      }}
      onExit={exit}
      externalDirty={editedTokens !== null}
      themeTokens={tokens ?? undefined}
      onThemeTokensChange={setEditedTokens}
      themeSettingsDisabled={!canPublish}
      themeSettingsNote={canPublish ? "Applies to every page of your store. Saved and live when you publish." : "You can view but not change theme settings."}
      publishLabel={page.hasUnpublishedChanges ? "Draft differs from live page" : undefined}
    />
  );
}
