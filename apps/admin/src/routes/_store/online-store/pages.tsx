import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Eye, EyeOff, FileText, History, LayoutDashboard, Plus, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormSkeleton,
  Input,
  Label,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  TableSkeleton,
  toast,
} from "@bs/ui";
import { orpc } from "../../../lib/orpc.ts";

// --- Block registry (mirrors the versioned schemas in @bs/blocks, document version 1) ---
type Scalar = { key: string; label: string; kind: "text" | "textarea" | "number" | "boolean" | "select" | "csv"; options?: string[]; required?: boolean; min?: number; max?: number };
type FieldSpec = Scalar | { key: string; label: string; kind: "list"; itemFields: Scalar[]; addLabel: string; min?: number };
type Props = Record<string, unknown>;

interface BlockMeta {
  type: string;
  label: string;
  description: string;
  fields: FieldSpec[];
  defaults: Props;
}

const align = ["left", "center", "right"];
const cols = ["2", "3", "4"];

const BLOCK_TYPES: BlockMeta[] = [
  {
    type: "Hero",
    label: "Hero",
    description: "Large headline with optional buttons",
    fields: [
      { key: "title", label: "Title", kind: "text", required: true },
      { key: "subtitle", label: "Subtitle", kind: "textarea" },
      { key: "ctaText", label: "Button text", kind: "text" },
      { key: "ctaLink", label: "Button link", kind: "text" },
      { key: "secondaryCtaText", label: "Second button text", kind: "text" },
      { key: "secondaryCtaLink", label: "Second button link", kind: "text" },
      { key: "backgroundMediaId", label: "Background media ID", kind: "text" },
      { key: "alignment", label: "Alignment", kind: "select", options: align },
      { key: "overlayOpacity", label: "Overlay opacity (0-100)", kind: "number", min: 0, max: 100 },
    ],
    defaults: { title: "Headline", subtitle: "", ctaText: "Shop now", ctaLink: "/collections/all", alignment: "center", overlayOpacity: 30 },
  },
  {
    type: "Banner",
    label: "Announcement banner",
    description: "Slim promotional strip",
    fields: [
      { key: "text", label: "Text", kind: "text", required: true },
      { key: "link", label: "Link", kind: "text" },
      { key: "dismissible", label: "Dismissible", kind: "boolean" },
      { key: "variant", label: "Style", kind: "select", options: ["info", "promo", "warning"] },
    ],
    defaults: { text: "Announcement", dismissible: false, variant: "promo" },
  },
  {
    type: "ProductGrid",
    label: "Product grid",
    description: "Grid of products, optionally from a collection",
    fields: [
      { key: "title", label: "Title", kind: "text", required: true },
      { key: "subtitle", label: "Subtitle", kind: "text" },
      { key: "collectionSlug", label: "Collection slug", kind: "text" },
      { key: "limit", label: "Products to show (1-48)", kind: "number", min: 1, max: 48 },
      { key: "columns", label: "Columns", kind: "select", options: cols },
      { key: "showPrice", label: "Show price", kind: "boolean" },
      { key: "showRating", label: "Show rating", kind: "boolean" },
    ],
    defaults: { title: "Featured products", limit: 8, columns: "4", showPrice: true, showRating: true },
  },
  {
    type: "CollectionGrid",
    label: "Collection grid",
    description: "Tiles linking to collections",
    fields: [
      { key: "title", label: "Title", kind: "text", required: true },
      { key: "subtitle", label: "Subtitle", kind: "text" },
      { key: "collectionSlugs", label: "Collection slugs (comma separated)", kind: "csv" },
      { key: "columns", label: "Columns", kind: "select", options: cols },
    ],
    defaults: { title: "Shop by category", collectionSlugs: [], columns: "3" },
  },
  {
    type: "ProductCarousel",
    label: "Product carousel",
    description: "Sliding row of products",
    fields: [
      { key: "title", label: "Title", kind: "text", required: true },
      { key: "subtitle", label: "Subtitle", kind: "text" },
      { key: "collectionSlug", label: "Collection slug", kind: "text" },
      { key: "limit", label: "Products to show (1-24)", kind: "number", min: 1, max: 24 },
      { key: "autoPlay", label: "Auto-play", kind: "boolean" },
    ],
    defaults: { title: "Trending", limit: 8, autoPlay: false },
  },
  {
    type: "Testimonials",
    label: "Testimonials",
    description: "Customer quotes",
    fields: [
      { key: "title", label: "Title", kind: "text" },
      {
        key: "items",
        label: "Testimonials",
        kind: "list",
        addLabel: "Add testimonial",
        min: 1,
        itemFields: [
          { key: "quote", label: "Quote", kind: "textarea", required: true },
          { key: "author", label: "Author", kind: "text", required: true },
          { key: "role", label: "Role or city", kind: "text" },
        ],
      },
    ],
    defaults: { title: "What customers say", items: [{ quote: "", author: "" }] },
  },
  {
    type: "Reviews",
    label: "Reviews",
    description: "Live product reviews",
    fields: [
      { key: "title", label: "Title", kind: "text" },
      { key: "showAggregate", label: "Show average rating", kind: "boolean" },
      { key: "limit", label: "Reviews to show (1-20)", kind: "number", min: 1, max: 20 },
    ],
    defaults: { title: "Customer reviews", showAggregate: true, limit: 6 },
  },
  {
    type: "RichText",
    label: "Rich text",
    description: "Formatted copy (HTML is sanitised on save)",
    fields: [
      { key: "content", label: "Content (HTML)", kind: "textarea", required: true },
      { key: "alignment", label: "Alignment", kind: "select", options: align },
    ],
    defaults: { content: "<p>Write something here.</p>", alignment: "left" },
  },
  {
    type: "FAQ",
    label: "FAQ",
    description: "Questions and answers",
    fields: [
      { key: "title", label: "Title", kind: "text" },
      {
        key: "items",
        label: "Questions",
        kind: "list",
        addLabel: "Add question",
        min: 1,
        itemFields: [
          { key: "question", label: "Question", kind: "text", required: true },
          { key: "answer", label: "Answer", kind: "textarea", required: true },
        ],
      },
    ],
    defaults: { title: "Frequently asked questions", items: [{ question: "", answer: "" }] },
  },
  {
    type: "Gallery",
    label: "Gallery",
    description: "Image gallery from your media library",
    fields: [
      { key: "title", label: "Title", kind: "text" },
      { key: "layout", label: "Layout", kind: "select", options: ["grid", "masonry"] },
      {
        key: "images",
        label: "Images",
        kind: "list",
        addLabel: "Add image",
        itemFields: [
          { key: "mediaId", label: "Media ID", kind: "text", required: true },
          { key: "caption", label: "Caption", kind: "text" },
          { key: "link", label: "Link", kind: "text" },
        ],
      },
    ],
    defaults: { layout: "grid", images: [] },
  },
  {
    type: "Newsletter",
    label: "Newsletter signup",
    description: "Email capture form",
    fields: [
      { key: "title", label: "Title", kind: "text" },
      { key: "subtitle", label: "Subtitle", kind: "text" },
      { key: "buttonText", label: "Button text", kind: "text" },
      { key: "placeholder", label: "Input placeholder", kind: "text" },
    ],
    defaults: {
      title: "Subscribe to our newsletter",
      subtitle: "Get updates on new releases and offers.",
      buttonText: "Subscribe",
      placeholder: "Enter your email address",
    },
  },
  {
    type: "UspStrip",
    label: "USP strip",
    description: "Row of short selling points",
    fields: [
      {
        key: "items",
        label: "Points",
        kind: "list",
        addLabel: "Add point",
        min: 1,
        itemFields: [
          { key: "icon", label: "Icon name", kind: "text", required: true },
          { key: "title", label: "Title", kind: "text", required: true },
          { key: "description", label: "Description", kind: "text", required: true },
        ],
      },
    ],
    defaults: { items: [{ icon: "Truck", title: "", description: "" }] },
  },
];

interface Block {
  id: string;
  type: string;
  version: number;
  props: Props;
  hidden?: boolean;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `blk-${Math.random().toString(36).slice(2, 10)}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function metaFor(type: string): BlockMeta | undefined {
  return BLOCK_TYPES.find((b) => b.type === type);
}

function toBlocks(raw: unknown[]): Block[] {
  const out: Block[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.type !== "string") continue;
    const block: Block = {
      id: o.id,
      type: o.type,
      version: typeof o.version === "number" ? o.version : 1,
      props: o.props && typeof o.props === "object" ? (o.props as Props) : {},
    };
    if (o.hidden === true) block.hidden = true;
    out.push(block);
  }
  return out;
}

function validateScalar(f: Scalar, value: unknown): string | null {
  if (f.kind === "number") {
    if (value === undefined || value === "" || value === null) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return `${f.label} must be a number`;
    if (f.min !== undefined && n < f.min) return `${f.label} must be at least ${f.min}`;
    if (f.max !== undefined && n > f.max) return `${f.label} must be at most ${f.max}`;
    return null;
  }
  if (f.required && (typeof value !== "string" || !value.trim())) return `${f.label} is required`;
  return null;
}

function validateBlock(block: Block): string | null {
  const meta = metaFor(block.type);
  if (!meta) return `Unknown block type "${block.type}"`;
  for (const f of meta.fields) {
    const value = block.props[f.key];
    if (f.kind === "list") {
      const list = Array.isArray(value) ? (value as Props[]) : [];
      if (f.min && list.length < f.min) return `${meta.label}: add at least ${f.min} item`;
      for (const item of list) for (const sf of f.itemFields) {
        const err = validateScalar(sf, item[sf.key]);
        if (err) return `${meta.label}: ${err}`;
      }
    } else {
      const err = validateScalar(f, value);
      if (err) return `${meta.label}: ${err}`;
    }
  }
  return null;
}

/** Drop empty optional strings and coerce numbers so the payload matches the block schemas. */
function cleanProps(meta: BlockMeta, props: Props): Props {
  const out: Props = {};
  const cleanScalar = (f: Scalar, v: unknown) => {
    if (f.kind === "number") return v === "" || v === undefined ? undefined : Number(v);
    if (f.kind === "csv") return Array.isArray(v) ? v : [];
    if (typeof v === "string" && v === "" && !f.required) return undefined;
    return v;
  };
  for (const f of meta.fields) {
    const v = props[f.key];
    if (f.kind === "list") {
      out[f.key] = (Array.isArray(v) ? (v as Props[]) : []).map((item) => {
        const row: Props = {};
        for (const sf of f.itemFields) {
          const c = cleanScalar(sf, item[sf.key]);
          if (c !== undefined) row[sf.key] = c;
        }
        return row;
      });
    } else {
      const c = cleanScalar(f, v);
      if (c !== undefined) out[f.key] = c;
    }
  }
  return out;
}

function PagesLoading() {
  return (
    <PageSkeleton>
      <TableSkeleton rows={5} columns={3} />
    </PageSkeleton>
  );
}

export const Route = createFileRoute("/_store/online-store/pages")({
  pendingComponent: () => <PagesLoading />,
  component: PagesPage,
});

function QueryError({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm font-medium text-foreground">Could not load {what}</p>
      <p className="text-sm text-foreground-light">{message}</p>
      <Button size="sm" onClick={onRetry}>
        <RotateCcw className="size-3.5" aria-hidden />
        Retry
      </Button>
    </div>
  );
}

export function PagesPage() {
  const queryClient = useQueryClient();
  const listQuery = useQuery(orpc.admin.pages.list.queryOptions());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const pages = listQuery.data ?? [];
  const activeId = selectedId && pages.some((p) => p.id === selectedId) ? selectedId : (pages[0]?.id ?? null);

  const newButton = (
    <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
      <Plus className="mr-1.5 size-3.5" aria-hidden />
      New page
    </Button>
  );

  return (
    <PageContainer size="full">
      <PageBreadcrumbs items={[{ label: "Online Store", href: "/online-store/theme" }, { label: "Pages" }]} actions={listQuery.data ? newButton : undefined} />
      <PageHeader title="Pages" description="Compose storefront pages from content blocks, save drafts and publish when ready." />

      {listQuery.isError ? (
        <QueryError what="pages" message={listQuery.error.message} onRetry={() => void listQuery.refetch()} />
      ) : !listQuery.data ? (
        <PagesLoading />
      ) : pages.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No pages yet"
          description="Create a page such as About or Contact, then build it from blocks."
          action={newButton}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Pages" className="grid content-start gap-1">
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-current={p.id === activeId ? "true" : undefined}
                className={`rounded-md border px-3 py-2 text-left text-sm ${
                  p.id === activeId ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-surface-100"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-foreground">{p.title}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      p.publishedVersionId ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
                    }`}
                  >
                    {p.publishedVersionId ? "Published" : "Draft"}
                  </span>
                </span>
                <span className="block font-mono text-xs text-foreground-lighter">/{p.slug}</span>
              </button>
            ))}
          </nav>
          {activeId ? <PageEditorLoader key={activeId} id={activeId} /> : null}
        </div>
      )}

      <CreatePageDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          setSelectedId(id);
          void queryClient.invalidateQueries({ queryKey: orpc.admin.pages.list.key() });
        }}
      />
    </PageContainer>
  );
}

function CreatePageDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const effectiveSlug = touched ? slug : slugify(title);
  const invalid = !title.trim() || !effectiveSlug;

  const create = useMutation(
    orpc.admin.pages.create.mutationOptions({
      onSuccess: (page) => {
        toast.success(`Page "${page.title}" created.`);
        setTitle("");
        setSlug("");
        setTouched(false);
        onOpenChange(false);
        onCreated(page.id);
      },
      onError: (err: Error) => toast.error(`Could not create page: ${err.message}`),
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) create.mutate({ title: title.trim(), slug: effectiveSlug });
          }}
        >
          <DialogHeader>
            <DialogTitle>New page</DialogTitle>
            <DialogDescription>The slug is the page address on your storefront.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor="page-title">Title</Label>
            <Input id="page-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="About us" required />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="page-slug">Slug</Label>
            <Input
              id="page-slug"
              value={effectiveSlug}
              onChange={(e) => {
                setTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="about-us"
              required
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={create.isPending} disabled={invalid}>
              Create page
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PageEditorLoader({ id }: { id: string }) {
  const query = useQuery(orpc.admin.pages.get.queryOptions({ input: { id } }));
  if (query.isError) return <QueryError what="this page" message={query.error.message} onRetry={() => void query.refetch()} />;
  if (!query.data) return <FormSkeleton fields={5} />;
  const p = query.data;
  return (
    <PageEditor
      key={`${p.id}:${p.updatedAt}`}
      id={p.id}
      initialTitle={p.title}
      initialSlug={p.slug}
      publishedVersionId={p.publishedVersionId ?? null}
      initialBlocks={toBlocks(p.blocks)}
    />
  );
}

interface VersionEntry {
  versionId: string;
  label: string;
}

function PageEditor({
  id,
  initialTitle,
  initialSlug,
  publishedVersionId,
  initialBlocks,
}: {
  id: string;
  initialTitle: string;
  initialSlug: string;
  publishedVersionId: string | null;
  initialBlocks: Block[];
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialBlocks));
  const [lastDraftId, setLastDraftId] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(publishedVersionId);
  const [history, setHistory] = useState<VersionEntry[]>(
    publishedVersionId ? [{ versionId: publishedVersionId, label: "Published version (loaded)" }] : [],
  );

  const navigate = useNavigate();
  const blocksDirty = JSON.stringify(blocks) !== baseline;
  const detailsDirty = title !== initialTitle || slug !== initialSlug;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.pages.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.pages.get.key({ input: { id } }) }),
    ]);

  const updateDetails = useMutation(
    orpc.admin.pages.update.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast.success("Page details saved.");
      },
      onError: (err: Error) => toast.error(`Could not save page details: ${err.message}`),
    }),
  );

  const saveDraft = useMutation(
    orpc.admin.pages.saveDraft.mutationOptions({
      onError: (err: Error) => toast.error(`Could not save draft: ${err.message}`),
    }),
  );
  const publish = useMutation(
    orpc.admin.pages.publish.mutationOptions({
      onError: (err: Error) => toast.error(`Could not publish page: ${err.message}`),
    }),
  );
  const rollback = useMutation(
    orpc.admin.pages.rollback.mutationOptions({
      onSuccess: async (res) => {
        setPublished(res.publishedVersionId);
        await refresh();
        toast.success("Rolled back to the selected version.");
      },
      onError: (err: Error) => toast.error(`Could not roll back: ${err.message}`),
    }),
  );

  const problem = (() => {
    for (const b of blocks) {
      const err = validateBlock(b);
      if (err) return err;
    }
    return null;
  })();

  const payload = () =>
    blocks.map((b) => {
      const meta = metaFor(b.type);
      const base = { id: b.id, type: b.type, version: b.version, props: meta ? cleanProps(meta, b.props) : b.props };
      return b.hidden ? { ...base, hidden: true } : base;
    });

  const persistDraft = async (): Promise<string | null> => {
    if (problem) {
      toast.error(problem);
      return null;
    }
    const res = await saveDraft.mutateAsync({ id, blocks: payload() });
    setLastDraftId(res.versionId);
    setBaseline(JSON.stringify(blocks));
    setHistory((h) => [{ versionId: res.versionId, label: `Draft saved ${new Date().toLocaleTimeString()}` }, ...h]);
    return res.versionId;
  };

  const handleSaveDraft = async () => {
    try {
      const v = await persistDraft();
      if (v) {
        await refresh();
        toast.success("Draft saved.");
      }
    } catch {
      /* error toast shown by mutation */
    }
  };

  const handlePublish = async () => {
    try {
      let versionId = lastDraftId ?? undefined;
      if (blocksDirty || !versionId) {
        if (blocksDirty) {
          const v = await persistDraft();
          if (!v) return;
          versionId = v;
        }
      }
      const res = await publish.mutateAsync(versionId ? { id, versionId } : { id });
      setPublished(res.publishedVersionId);
      setHistory((h) =>
        h.some((e) => e.versionId === res.publishedVersionId)
          ? h
          : [{ versionId: res.publishedVersionId, label: "Published version" }, ...h],
      );
      await refresh();
      toast.success("Page published.");
    } catch {
      /* error toast shown by mutation */
    }
  };

  const busy = saveDraft.isPending || publish.isPending || rollback.isPending;

  const addBlock = (meta: BlockMeta) => {
    const block: Block = { id: newId(), type: meta.type, version: 1, props: structuredClone(meta.defaults) };
    setBlocks((prev) => [...prev, block]);
    setOpenBlockId(block.id);
  };
  const patchBlock = (blockId: string, patch: Partial<Block>) =>
    setBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, ...patch } : b)));
  const toggleHidden = (blockId: string) =>
    setBlocks((prev) =>
      prev.map((x) => {
        if (x.id !== blockId) return x;
        if (x.hidden) {
          const { hidden: _hidden, ...rest } = x;
          return rest;
        }
        return { ...x, hidden: true };
      }),
    );
  const moveBlock = (idx: number, dir: -1 | 1) =>
    setBlocks((prev) => {
      const t = idx + dir;
      const a = prev[idx];
      const b = prev[t];
      if (!a || !b) return prev;
      const next = [...prev];
      next[idx] = b;
      next[t] = a;
      return next;
    });

  return (
    <div className="grid content-start gap-4">
      <PageSection
        title="Page details"
        actions={
          <Button
            size="sm"
            loading={updateDetails.isPending}
            disabled={!detailsDirty || !title.trim() || !slug.trim()}
            onClick={() => updateDetails.mutate({ id, title: title.trim(), slug: slug.trim() })}
          >
            <Save className="mr-1.5 size-3.5" aria-hidden />
            Save details
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="edit-title">Title</Label>
            <Input id="edit-title" value={title} aria-invalid={!title.trim()} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="edit-slug">Slug</Label>
            <Input id="edit-slug" value={slug} aria-invalid={!slug.trim()} onChange={(e) => setSlug(slugify(e.target.value))} />
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Content blocks"
        description={published ? "This page is live. Publish again to release your changes." : "This page is not published yet."}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={blocksDirty || busy}
              title={blocksDirty ? "Save your draft first, then open the visual editor" : undefined}
              onClick={() => void navigate({ to: "/online-store/editor/$pageId", params: { pageId: id } })}
            >
              <LayoutDashboard className="mr-1.5 size-3.5" aria-hidden />
              Design visually
            </Button>
            <Button size="sm" loading={saveDraft.isPending} disabled={!blocksDirty || busy} onClick={() => void handleSaveDraft()}>
              <Save className="mr-1.5 size-3.5" aria-hidden />
              Save draft
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={publish.isPending}
              disabled={busy || (!blocksDirty && !lastDraftId && blocks.length === 0)}
              onClick={() => void handlePublish()}
            >
              <Upload className="mr-1.5 size-3.5" aria-hidden />
              Publish
            </Button>
          </div>
        }
      >
        {blocks.length === 0 ? (
          <EmptyState icon={FileText} title="This page has no blocks" description="Add a block below to start building the page." />
        ) : (
          <ol className="grid gap-2">
            {blocks.map((b, idx) => {
              const meta = metaFor(b.type);
              const open = openBlockId === b.id;
              const err = validateBlock(b);
              return (
                <li key={b.id} className="rounded-md border border-border bg-surface-50">
                  <div className="flex items-center justify-between gap-2 p-3">
                    <button
                      type="button"
                      className="flex-1 text-left"
                      aria-expanded={open}
                      onClick={() => setOpenBlockId(open ? null : b.id)}
                    >
                      <span className="text-sm font-medium text-foreground">{meta?.label ?? b.type}</span>
                      {b.hidden ? <span className="ml-2 text-xs text-foreground-lighter">(hidden)</span> : null}
                      {err ? <span className="ml-2 text-xs text-destructive">{err}</span> : null}
                    </button>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" aria-label="Move block up" disabled={idx === 0} onClick={() => moveBlock(idx, -1)}>
                        <ArrowUp />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Move block down" disabled={idx === blocks.length - 1} onClick={() => moveBlock(idx, 1)}>
                        <ArrowDown />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={b.hidden ? "Show block" : "Hide block"}
                        onClick={() => toggleHidden(b.id)}
                      >
                        {b.hidden ? <EyeOff /> : <Eye />}
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Remove block" onClick={() => setBlocks((prev) => prev.filter((x) => x.id !== b.id))}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  {open && meta ? (
                    <div className="grid gap-3 border-t border-border p-3">
                      <BlockFields meta={meta} props={b.props} onChange={(props) => patchBlock(b.id, { props })} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Add a block</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {BLOCK_TYPES.map((meta) => (
              <Button key={meta.type} size="sm" title={meta.description} onClick={() => addBlock(meta)}>
                <Plus className="mr-1 size-3.5" aria-hidden />
                {meta.label}
              </Button>
            ))}
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Versions"
        description="Versions saved or published in this session. The service does not expose a full version history."
      >
        {history.length === 0 ? (
          <p className="text-sm text-foreground-lighter">No versions yet. Save a draft to create one.</p>
        ) : (
          <ul className="grid gap-2">
            {history.map((h) => (
              <li key={h.versionId} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                <span className="flex items-center gap-2">
                  <History className="size-4 text-foreground-lighter" aria-hidden />
                  {h.label}
                  {h.versionId === published ? (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">Live</span>
                  ) : null}
                </span>
                <Button
                  size="sm"
                  disabled={h.versionId === published || busy}
                  loading={rollback.isPending && rollback.variables?.targetVersionId === h.versionId}
                  onClick={() => rollback.mutate({ id, targetVersionId: h.versionId })}
                >
                  <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
                  Roll back to this
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </div>
  );
}

function ScalarInput({
  spec,
  value,
  onChange,
  idPrefix,
}: {
  spec: Scalar;
  value: unknown;
  onChange: (v: unknown) => void;
  idPrefix: string;
}) {
  const id = `${idPrefix}-${spec.key}`;
  const invalid = validateScalar(spec, value) !== null;
  const label = (
    <Label htmlFor={id}>
      {spec.label}
      {spec.required ? " *" : ""}
    </Label>
  );
  if (spec.kind === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm text-foreground-light">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {spec.label}
      </label>
    );
  }
  if (spec.kind === "select") {
    return (
      <div className="grid gap-1">
        {label}
        <select
          id={id}
          value={typeof value === "string" ? value : (spec.options?.[0] ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 rounded-md border border-border-control bg-control px-2 text-sm"
        >
          {(spec.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (spec.kind === "textarea") {
    return (
      <div className="grid gap-1">
        {label}
        <textarea
          id={id}
          rows={4}
          aria-invalid={invalid}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-md border border-border-control bg-control px-3 py-2 text-sm"
        />
      </div>
    );
  }
  if (spec.kind === "csv") {
    return (
      <div className="grid gap-1">
        {label}
        <Input
          id={id}
          defaultValue={Array.isArray(value) ? value.join(", ") : ""}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      {label}
      <Input
        id={id}
        type={spec.kind === "number" ? "number" : "text"}
        aria-invalid={invalid}
        value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
        onChange={(e) => onChange(spec.kind === "number" ? e.target.value : e.target.value)}
      />
    </div>
  );
}

function BlockFields({ meta, props, onChange }: { meta: BlockMeta; props: Props; onChange: (p: Props) => void }) {
  const set = (key: string, value: unknown) => onChange({ ...props, [key]: value });
  return (
    <>
      {meta.fields.map((f) => {
        if (f.kind !== "list") {
          return <ScalarInput key={f.key} spec={f} value={props[f.key]} onChange={(v) => set(f.key, v)} idPrefix={meta.type} />;
        }
        const list = Array.isArray(props[f.key]) ? (props[f.key] as Props[]) : [];
        const blank: Props = {};
        for (const sf of f.itemFields) blank[sf.key] = "";
        return (
          <fieldset key={f.key} className="grid gap-2">
            <legend className="text-sm font-medium text-foreground-light">{f.label}</legend>
            {list.map((item, i) => (
              <div key={i} className="grid gap-2 rounded-md border border-border p-3">
                {f.itemFields.map((sf) => (
                  <ScalarInput
                    key={sf.key}
                    spec={sf}
                    value={item[sf.key]}
                    idPrefix={`${meta.type}-${f.key}-${i}`}
                    onChange={(v) => set(f.key, list.map((x, xi) => (xi === i ? { ...x, [sf.key]: v } : x)))}
                  />
                ))}
                <div>
                  <Button size="sm" variant="ghost" onClick={() => set(f.key, list.filter((_, xi) => xi !== i))}>
                    <Trash2 className="mr-1 size-3.5" aria-hidden />
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <div>
              <Button size="sm" onClick={() => set(f.key, [...list, { ...blank }])}>
                <Plus className="mr-1 size-3.5" aria-hidden />
                {f.addLabel}
              </Button>
            </div>
          </fieldset>
        );
      })}
    </>
  );
}
