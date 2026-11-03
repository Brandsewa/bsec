import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BlockEditor, type BlockEditorHost, type EditorPageKind, type MediaAsset } from "@bs/block-editor";
import { WEBSITE_BLOCK_VARS, type BlockInstance } from "@bs/blocks";
import type { MediaKind } from "@bs/contracts";
import { Button, EmptyState, PageContainer, PageSkeleton } from "@bs/ui";
import { MediaPickerDialog } from "@bs/content-admin/media/media-picker-dialog.tsx";
import { client as contentClient, orpc } from "@bs/content-admin/host.ts";
import { client } from "../lib/orpc.ts";

const baseHost: BlockEditorHost = {
  // Images and the header menu resolve through the website record's own data.
  loadRenderData: (blocks) => client.marketing.pages.blockData({ blocks }),
  async listMenus() {
    try {
      return (await client.marketing.menus.list()).map((m) => ({ handle: m.handle, title: m.name }));
    } catch {
      return [];
    }
  },
  // The website has no catalogue.
  listCollections: () => Promise.resolve([]),
  listCategories: () => Promise.resolve([]),
};

/** Visual editor for one page of bcom.si. Same draft and publish flow as a store page, with the website's header and footer around it. */
export default function MarketingPageEditor({ id }: { id: string }) {
  // A fresh editor per page, so switching pages never carries edits over.
  return <PageEditor key={id} id={id} />;
}

function PageEditor({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pageQuery = useQuery(orpc.admin.pages.get.queryOptions({ input: { id, draft: true } }));
  const listQuery = useQuery(orpc.admin.pages.list.queryOptions());
  // The header and footer are pages of their own; they start from today's layout the first time the builder opens.
  const chromeQuery = useQuery({
    queryKey: ["marketing-chrome"],
    queryFn: async () => {
      const [header, footer] = await Promise.all([client.marketing.pages.ensureChrome({ key: "header" }), client.marketing.pages.ensureChrome({ key: "footer" })]);
      if (header.created || footer.created) await queryClient.invalidateQueries({ queryKey: orpc.admin.pages.list.key() });
      return { header: header.id, footer: footer.id };
    },
    staleTime: Infinity,
  });
  const headerId = chromeQuery.data?.header;
  const footerId = chromeQuery.data?.footer;
  const headerQuery = useQuery({ ...orpc.admin.pages.get.queryOptions({ input: { id: headerId ?? "", draft: true } }), enabled: Boolean(headerId) });
  const footerQuery = useQuery({ ...orpc.admin.pages.get.queryOptions({ input: { id: footerId ?? "", draft: true } }), enabled: Boolean(footerId) });
  // Changes made in the Header and Footer tabs are held here and saved with the page, and published with it.
  const [frameEdits, setFrameEdits] = useState<{ header?: BlockInstance[]; footer?: BlockInstance[] }>({});
  const frame = useMemo(
    () => ({
      header: frameEdits.header ?? ((headerQuery.data?.blocks ?? []) as BlockInstance[]),
      footer: frameEdits.footer ?? ((footerQuery.data?.blocks ?? []) as BlockInstance[]),
    }),
    [headerQuery.data, footerQuery.data, frameEdits],
  );

  const [picker, setPicker] = useState<{ open: boolean; accept?: MediaKind[] | undefined; multiple?: boolean | undefined; max?: number | undefined; selected?: string[] | undefined; resolve?: ((items: MediaAsset[]) => void) | undefined }>({ open: false });
  const host = useMemo<BlockEditorHost>(
    () => ({
      ...baseHost,
      pickMedia: (opts) =>
        new Promise<MediaAsset[]>((resolve) => {
          setPicker({ open: true, accept: opts.accept as MediaKind[], multiple: opts.multiple, max: opts.max, selected: opts.selected, resolve });
        }),
    }),
    [],
  );

  const page = pageQuery.data;
  const kind: EditorPageKind = page?.type === "header" ? "marketingHeader" : page?.type === "footer" ? "marketingFooter" : "marketing";
  const exit = () => void navigate({ to: "/storefront/pages" });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.pages.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.pages.get.key({ input: { id } }) }),
    ]);

  const options = useMemo(() => {
    const list = listQuery.data ?? [];
    const out: Array<{ value: string; label: string }> = [];
    if (headerId) out.push({ value: headerId, label: "Header" });
    for (const p of list) if (p.type !== "header" && p.type !== "footer") out.push({ value: p.id, label: p.title || p.slug });
    if (footerId) out.push({ value: footerId, label: "Footer" });
    return out;
  }, [listQuery.data, headerId, footerId]);

  if (pageQuery.isError) {
    return (
      <PageContainer size="small">
        <EmptyState title="Could not load this page" description={pageQuery.error.message} action={<Button onClick={exit}>Back to pages</Button>} />
      </PageContainer>
    );
  }
  if (!page || !chromeQuery.data) return <PageSkeleton />;

  const site = import.meta.env.VITE_MARKETING_URL ?? "https://bcom.si";
  const previewHref = page.type === "header" || page.type === "footer" ? site : `${site}${page.slug === "about" ? "/about" : `/pages/${page.slug}`}`;

  const framePages: Array<["header" | "footer", string | undefined]> = [["header", headerId], ["footer", footerId]];
  /** Saves the header/footer edits as drafts of their own pages; returns the version ids so Publish can publish them. */
  const saveFrame = async () => {
    const saved: Array<{ id: string; versionId: string }> = [];
    for (const [part, pid] of framePages) {
      const blocks = frameEdits[part];
      if (!blocks || !pid || pid === id) continue;
      const r = await contentClient.admin.pages.saveDraft({ id: pid, blocks });
      saved.push({ id: pid, versionId: r.versionId });
    }
    if (saved.length > 0) {
      setFrameEdits({});
      await Promise.all([headerQuery.refetch(), footerQuery.refetch()]);
    }
    return saved;
  };

  return (
    <>
      <BlockEditor
        title={`Editing: ${page.title}`}
        initialBlocks={page.blocks as BlockInstance[]}
        host={host}
        themeVars={WEBSITE_BLOCK_VARS}
        storeName="BCOM"
        pageKind={kind}
        frame={frame}
        onFrameChange={(part, blocks) => setFrameEdits((e) => ({ ...e, [part]: blocks }))}
        externalDirty={Object.keys(frameEdits).length > 0}
        previewHref={previewHref}
        pages={options.length > 0 ? { value: id, options, onChange: (next) => void navigate({ to: "/storefront/pages/$id/editor", params: { id: next } }) } : undefined}
        onSaveDraft={async (blocks) => {
          await contentClient.admin.pages.saveDraft({ id, blocks });
          await saveFrame();
          await refresh();
        }}
        onPublish={async (blocks) => {
          const { versionId } = await contentClient.admin.pages.saveDraft({ id, blocks });
          await contentClient.admin.pages.publish({ id, versionId });
          for (const s of await saveFrame()) await contentClient.admin.pages.publish({ id: s.id, versionId: s.versionId });
          await refresh();
        }}
        onExit={exit}
        publishLabel={page.hasUnpublishedChanges ? "Draft differs from live page" : undefined}
      />
      <MediaPickerDialog
        open={picker.open}
        onOpenChange={(open) => {
          if (!open) {
            picker.resolve?.([]);
            setPicker({ open: false });
          }
        }}
        accept={picker.accept}
        multiple={picker.multiple}
        max={picker.max}
        selected={picker.selected}
        onSelect={(items) => {
          picker.resolve?.(items.map((m) => ({ id: m.id, url: m.url ?? "", alt: m.alt, kind: m.kind, filename: m.filename, mime: m.mime, thumbnailUrl: m.thumbnailUrl ?? undefined })));
          setPicker({ open: false });
        }}
      />
    </>
  );
}
