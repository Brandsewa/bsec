import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BlockEditor, type BlockEditorHost } from "@bs/block-editor";
import { computeThemeTokens, walkBlocks, type BlockInstance } from "@bs/blocks";
import { Button, EmptyState, PageContainer, PageSkeleton } from "@bs/ui";
import { client, orpc } from "../lib/orpc.ts";

/**
 * Platform theme editor. Themes are store-independent, so product and collection widgets preview
 * with sample data, and images are chosen by each store after activation.
 */
const sampleProducts = (limit: number) =>
  Array.from({ length: Math.min(limit, 8) }, (_, i) => ({
    id: `sample-${i}`,
    title: `Sample product ${i + 1}`,
    slug: `sample-${i + 1}`,
    priceMin: 49900 + i * 10000,
    compareAtPriceMin: i % 3 === 0 ? 69900 + i * 10000 : undefined,
    ratingAvg: "4.5",
    ratingCount: 12 + i,
  }));

const host: BlockEditorHost = {
  loadRenderData(blocks) {
    const data: Record<string, unknown> = {};
    walkBlocks(blocks as BlockInstance[], (b) => {
      if (b.type === "ProductGrid" || b.type === "ProductCarousel") {
        data[b.id] = { kind: "products", products: sampleProducts(Number(b.props.limit) || 8) };
      } else if (b.type === "CollectionGrid") {
        data[b.id] = {
          kind: "collections",
          collections: ["Collection one", "Collection two", "Collection three"].map((t, i) => ({ slug: `c${i}`, title: t })),
        };
      }
    });
    return Promise.resolve({ data, media: {} });
  },
};

export default function TemplateEditor({ code }: { code: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery(orpc.templates.get.queryOptions({ input: { code } }));
  const exit = () => void navigate({ to: "/templates" });
  const themeVars = useMemo(() => computeThemeTokens(null, (query.data?.draftTokens ?? null) as never), [query.data]);

  if (query.isError) {
    return (
      <PageContainer size="small">
        <EmptyState title="Could not load this theme" description={query.error.message} action={<Button onClick={exit}>Back to themes</Button>} />
      </PageContainer>
    );
  }
  if (!query.data) return <PageSkeleton />;
  const tpl = query.data;

  const save = async (blocks: BlockInstance[]) => {
    await client.templates.saveDraft({ code, pages: { ...tpl.draftPages, home: blocks }, tokens: tpl.draftTokens });
    await queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
  };

  return (
    <BlockEditor
      title={`Theme: ${tpl.name} (homepage). Stores keep their own copy.`}
      initialBlocks={(tpl.draftPages.home ?? []) as BlockInstance[]}
      host={host}
      themeVars={themeVars}
      onSaveDraft={save}
      onPublish={async (blocks) => {
        await save(blocks);
        await client.templates.publish({ code });
        await queryClient.invalidateQueries({ queryKey: orpc.templates.get.key({ input: { code } }) });
      }}
      onExit={exit}
    />
  );
}
