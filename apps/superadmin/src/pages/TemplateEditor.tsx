import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BlockEditor, type BlockEditorHost, type EditorPageKind, type ThemeTokens } from "@bs/block-editor";
import { buildSampleRenderData, computeThemeTokens, googleFontsHref, type BlockInstance } from "@bs/blocks";
import { Button, EmptyState, PageContainer, PageSkeleton, toast } from "@bs/ui";
import { client, orpc } from "../lib/orpc.ts";

/**
 * Platform theme builder. A theme is a set of settings (colours, fonts, corners, buttons; edited from the "Theme" tab in the page editor's sidebar, on every page) plus
 * one block layout per page: home, collection, product, cart, header and footer. Everything is edited
 * on the draft; publishing makes it available to stores, which keep their own copy.
 * Products and collections preview with sample data because a theme belongs to no store.
 */
const host: BlockEditorHost = {
  // A theme belongs to no store, so data blocks preview with the shared sample products and collections.
  loadRenderData: (blocks) => Promise.resolve(buildSampleRenderData(blocks as BlockInstance[])),
};

const TABS = [
  { key: "home", label: "Home page", kind: "home" },
  { key: "collection", label: "Collection page", kind: "collection" },
  { key: "product", label: "Product page", kind: "product" },
  { key: "cart", label: "Cart page", kind: "cart" },
  { key: "header", label: "Header", kind: "header" },
  { key: "footer", label: "Footer", kind: "footer" },
] as const satisfies ReadonlyArray<{ key: string; label: string; kind?: EditorPageKind }>;
type TabKey = (typeof TABS)[number]["key"];

type Pages = Record<string, BlockInstance[]>;

export default function TemplateEditor({ code }: { code: string }) {
  const navigate = useNavigate();
  const query = useQuery(orpc.templates.get.queryOptions({ input: { code } }));
  const exit = () => void navigate({ to: "/templates" });

  if (query.isError) {
    return (
      <PageContainer size="small">
        <EmptyState title="Could not load this theme" description={query.error.message} action={<Button onClick={exit}>Back to themes</Button>} />
      </PageContainer>
    );
  }
  if (!query.data) return <PageSkeleton />;
  return (
    <Workspace
      code={code}
      name={query.data.name}
      isActive={query.data.isActive}
      initialPages={query.data.draftPages as Pages}
      initialTokens={query.data.draftTokens as ThemeTokens}
      onExit={exit}
    />
  );
}

function Workspace({
  code,
  name,
  isActive,
  initialPages,
  initialTokens,
  onExit,
}: {
  code: string;
  name: string;
  isActive: boolean;
  initialPages: Pages;
  initialTokens: ThemeTokens;
  onExit: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("home");
  const [tokens, setTokens] = useState<ThemeTokens>(initialTokens);
  // The canvas reports every edit here, so switching tabs never loses work.
  const [pages, setPages] = useState<Pages>(initialPages);
  const [dirty, setDirty] = useState(false);
  const [live, setLive] = useState(isActive);

  const themeVars = useMemo(() => computeThemeTokens(null, tokens), [tokens]);
  const fontsHref = useMemo(() => googleFontsHref(tokens), [tokens]);

  // Theme settings are global: edited from the sidebar of any page, they restyle every page's canvas.
  const onThemeTokensChange = useCallback((t: ThemeTokens) => {
    setTokens(t);
    setDirty(true);
  }, []);

  const saveAll = async (next: Pages) => {
    await client.templates.saveDraft({ code, pages: next, tokens });
    await queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
    setDirty(false);
  };

  // Saving and publishing are the editor toolbar's own Save draft / Publish buttons; they report errors in its status line.
  const publish = async (next: Pages) => {
    await saveAll(next);
    const r = await client.templates.publish({ code });
    await queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
    setLive(true);
    toast.success(`Published as version ${r.version}. Stores that already use this theme see "Update available" in their Themes screen; their own copy is never changed until they apply it.`);
  };

  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#fafafa" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
          <BlockEditor
            key={tab}
            title={`${active.label} · ${name}`}
            height="100%"
            pageKind={"kind" in active ? active.kind : "custom"}
            initialBlocks={pages[tab] ?? []}
            host={host}
            themeVars={themeVars}
            storeName={name}
            fontsHref={fontsHref}
            externalDirty={dirty}
            onBlocksChange={(blocks) => {
              setPages((p) => ({ ...p, [tab]: blocks }));
              setDirty(true);
            }}
            onSaveDraft={async (blocks) => {
              const next = { ...pages, [tab]: blocks };
              setPages(next);
              await saveAll(next);
            }}
            onPublish={async (blocks) => {
              const next = { ...pages, [tab]: blocks };
              setPages(next);
              await publish(next);
            }}
            onExit={onExit}
            exitLabel="Themes"
            onPreview={async () => {
              // The editor has just saved the draft; the link shows that saved draft (a snapshot) with sample data.
              const r = await client.templates.createPreview({ code });
              const url = `${r.url}?page=${tab}`;
              try {
                await navigator.clipboard.writeText(url);
                toast.success(`Preview link copied (valid for 24 hours): ${url}`);
              } catch {
                toast.success(`Preview link (valid for 24 hours): ${url}`);
              }
              return url;
            }}
            pages={{ value: tab, options: TABS.map((x) => ({ value: x.key, label: x.label })), onChange: (v) => setTab(v as TabKey) }}
            publishLabel={live ? "Published" : "Draft: hidden from stores"}
            themeTokens={tokens}
            onThemeTokensChange={onThemeTokensChange}
          />
      </div>
    </div>
  );
}
