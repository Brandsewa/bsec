import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BlockEditor, ThemeSettingsEditor, type BlockEditorHost, type EditorPageKind, type ThemeTokens } from "@bs/block-editor";
import { computeThemeTokens, googleFontsHref, walkBlocks, type BlockInstance } from "@bs/blocks";
import { Button, EmptyState, PageContainer, PageSkeleton, toast } from "@bs/ui";
import { client, orpc } from "../lib/orpc.ts";

/**
 * Platform theme builder. A theme is a set of settings (colours, fonts, corners, buttons) plus
 * one block layout per page: home, collection, product, header and footer. Everything is edited
 * on the draft; publishing makes it available to stores, which keep their own copy.
 * Products and collections preview with sample data because a theme belongs to no store.
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

const TABS = [
  { key: "settings", label: "Theme settings" },
  { key: "home", label: "Home page", kind: "home" },
  { key: "collection", label: "Collection page", kind: "collection" },
  { key: "product", label: "Product page", kind: "product" },
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
  const [tab, setTab] = useState<TabKey>("settings");
  const [tokens, setTokens] = useState<ThemeTokens>(initialTokens);
  // The canvas reports every edit here, so switching tabs never loses work.
  const [pages, setPages] = useState<Pages>(initialPages);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [live, setLive] = useState(isActive);

  const themeVars = useMemo(() => computeThemeTokens(null, tokens), [tokens]);
  const fontsHref = useMemo(() => googleFontsHref(tokens), [tokens]);

  const saveAll = async (next: Pages) => {
    await client.templates.saveDraft({ code, pages: next, tokens });
    await queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
    setDirty(false);
  };

  const run = async (kind: "save" | "publish", next: Pages = pages) => {
    setBusy(kind);
    try {
      await saveAll(next);
      if (kind === "publish") {
        const r = await client.templates.publish({ code });
        await queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
        setLive(true);
        toast.success(`Published as version ${r.version}. Stores keep their own customised copy.`);
      } else {
        toast.success("Draft saved");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  };

  const previewBlocks = useMemo(() => [...(pages["header"] ?? []), ...(pages["home"] ?? []), ...(pages["footer"] ?? [])], [pages]);

  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#fafafa" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 16px", height: 52, borderBottom: "1px solid #e4e4e7", background: "#fff", flex: "none" }}>
        <Button size="sm" onClick={() => (dirty && !window.confirm("You have unsaved changes. Leave without saving?") ? undefined : onExit())}>
          ← Themes
        </Button>
        <strong style={{ fontSize: 14 }}>{name}</strong>
        <nav aria-label="Theme sections" style={{ display: "flex", gap: 4, marginLeft: 8 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-current={t.key === tab ? "page" : undefined}
              onClick={() => setTab(t.key)}
              style={{
                border: 0,
                background: t.key === tab ? "#111" : "transparent",
                color: t.key === tab ? "#fff" : "#27272a",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span style={{ marginLeft: "auto", fontSize: 12, color: dirty ? "#b26a00" : "#71717a" }}>{dirty ? "Unsaved changes" : live ? "Published" : "Draft: hidden from stores"}</span>
        <Button size="sm" disabled={!dirty || busy !== null} loading={busy === "save"} onClick={() => void run("save")}>
          Save draft
        </Button>
        <Button size="sm" variant="primary" disabled={busy !== null} loading={busy === "publish"} onClick={() => void run("publish")}>
          Publish theme
        </Button>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === "settings" ? (
          <ThemeSettingsEditor
            tokens={tokens}
            onChange={(t) => {
              setTokens(t);
              setDirty(true);
            }}
            previewBlocks={previewBlocks}
            host={host}
            storeName={name}
          />
        ) : (
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
              await run("publish", next);
            }}
            onExit={onExit}
          />
        )}
      </div>
    </div>
  );
}
