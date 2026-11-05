import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Redo2, Save, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, PageContainer, TableSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category, Collection, RichDescription } from "@bs/contracts";
import { MediaPickerDialog } from "@bs/content-admin/media/media-picker-dialog.tsx";
import PolicyRichEditor from "../policy-rich-editor.tsx";
import { BulkGrid, CheckCell, GridColumnsMenu, PopoverCell, SelectCell, TextCell, emptyDash, type BulkColumn, type BulkRow } from "./bulk-grid.tsx";
import { useColumnVisibility } from "../data-table/use-table-state.ts";
import { editKey, parseWhole, slugify, useEdits, type Edits } from "../../lib/bulk-edit.ts";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

type Kind = "categories" | "collections";
type Rec = Category | Collection;
interface TRow extends BulkRow {
  rec: Rec;
}

const COLLECTION_SORTS = [
  { value: "manual", label: "Manual" },
  { value: "best_selling", label: "Best selling" },
  { value: "title_asc", label: "Title A-Z" },
  { value: "title_desc", label: "Title Z-A" },
  { value: "price_asc", label: "Price, low to high" },
  { value: "price_desc", label: "Price, high to low" },
  { value: "created_desc", label: "Newest first" },
  { value: "created_asc", label: "Oldest first" },
];

const nameOf = (r: Rec) => ("name" in r ? r.name : r.title);
const richStr = (v: RichDescription | null | undefined) => (v && v.blocks.length ? JSON.stringify(v) : "");

function readIds(kind: Kind): string[] {
  try {
    const raw = sessionStorage.getItem(`bulk-edit:${kind}`);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Builds the bulkUpdate items for either kind. Errors are keyed like the edits. */
export function buildTaxonomyItems(kind: Kind, recs: Rec[], edits: Edits) {
  const errors: Record<string, string> = {};
  const items: Array<Record<string, unknown> & { id: string }> = [];
  const str = (id: string, f: string) => {
    const v = edits[editKey(id, f)];
    return typeof v === "string" ? v : undefined;
  };
  for (const r of recs) {
    const it: Record<string, unknown> & { id: string } = { id: r.id };
    const nameField = kind === "categories" ? "name" : "title";
    const name = str(r.id, "name");
    if (name !== undefined) {
      if (!name.trim()) errors[editKey(r.id, "name")] = "A name is required";
      else it[nameField] = name.trim();
    }
    const slug = str(r.id, "slug");
    if (slug !== undefined) {
      const s = slugify(slug);
      if (!s) errors[editKey(r.id, "slug")] = "A URL handle is required";
      else it["slug"] = s;
    }
    const desc = str(r.id, "description");
    if (desc !== undefined) {
      const max = kind === "categories" ? 500 : 300;
      if (desc.length > max) errors[editKey(r.id, "description")] = `Up to ${max} characters`;
      else it["description"] = desc.trim() || null;
    }
    const rich = str(r.id, "descriptionJson");
    if (rich !== undefined) it["descriptionJson"] = rich ? (JSON.parse(rich) as RichDescription) : null;
    const img = str(r.id, "imageMediaId");
    if (img !== undefined) it["imageMediaId"] = img || null;
    const st = str(r.id, "seoTitle");
    const sd = str(r.id, "seoDescription");
    if (st !== undefined || sd !== undefined) {
      const cur = (r.seo ?? {}) as { title?: string | null; description?: string | null };
      it["seo"] = { title: (st ?? cur.title ?? "").trim() || null, description: (sd ?? cur.description ?? "").trim() || null };
    }
    for (const f of kind === "categories" ? (["isActive", "isFeatured"] as const) : (["published", "indexable"] as const)) {
      const b = edits[editKey(r.id, f)];
      if (typeof b === "boolean") it[f] = b;
    }
    const sort = str(r.id, "sortOrder");
    if (sort) it["sortOrder"] = sort;
    const parent = str(r.id, "parentId");
    if (parent !== undefined) it["parentId"] = parent || null;
    const pos = str(r.id, "position");
    if (pos !== undefined) {
      const p = parseWhole(pos, 100000);
      if (!p.ok || p.value === null) errors[editKey(r.id, "position")] = p.ok ? "Enter a number" : p.error;
      else it["position"] = p.value;
    }
    if (Object.keys(it).length > 1) items.push(it);
  }
  return { items, errors };
}

export function TaxonomyBulkEditor({ kind }: { kind: Kind }) {
  const isCat = kind === "categories";
  const noun = isCat ? "category" : "collection";
  const nounPlural = isCat ? "categories" : "collections";
  const [ids] = useState(() => readIds(kind));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ed = useEdits();
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [images, setImages] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<string | null>(null);

  const catList = useQuery({ ...orpc.admin.categories.list.queryOptions({ input: { status: "all" } }), enabled: isCat });
  const colList = useQuery({ ...orpc.admin.collections.list.queryOptions({ input: { status: "all" } }), enabled: !isCat });
  const list = isCat ? catList : colList;
  const recs = useMemo(() => {
    const all = (list.data ?? []) as Rec[];
    const want = new Set(ids);
    const order = new Map(ids.map((id, i) => [id, i]));
    return all.filter((r) => want.has(r.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [list.data, ids]);
  const parentOptions = useMemo(
    () => [{ value: "", label: "None (top level)" }, ...((isCat ? ((list.data ?? []) as Category[]) : []).map((c) => ({ value: c.id, label: c.name })))],
    [isCat, list.data],
  );

  const { items, errors } = useMemo(() => buildTaxonomyItems(kind, recs, ed.edits), [kind, recs, ed.edits]);
  const errorCount = Object.keys(errors).length;

  useEffect(() => {
    if (ed.count === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [ed.count]);

  const save = useMutation({
    mutationFn: async () => {
      const out: Array<{ id: string; ok: boolean; error?: string | undefined }> = [];
      for (let i = 0; i < items.length; i += 100) {
        const chunk = items.slice(i, i + 100);
        const r = isCat
          ? await client.admin.categories.bulkUpdate({ items: chunk as never })
          : await client.admin.collections.bulkUpdate({ items: chunk as never });
        out.push(...r.results);
      }
      return out;
    },
    onSuccess: async (results) => {
      const bad = results.filter((r) => !r.ok);
      setFailed(Object.fromEntries(bad.map((r) => [r.id, r.error ?? "Could not save"])));
      ed.keepOnly(new Set(bad.map((r) => r.id)));
      await queryClient.invalidateQueries({ queryKey: isCat ? orpc.admin.categories.key() : orpc.admin.collections.key() });
      if (bad.length === 0) toast.success(`Saved ${results.length} ${results.length === 1 ? noun : nounPlural}`);
      else toast.error(`${results.length - bad.length} saved, ${bad.length} could not be saved. See the red rows.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const err = (id: string, f: string) => errors[editKey(id, f)];
  const text = (r: Rec, f: string, saved: string, o?: { align?: "right"; mono?: boolean }) => (
    <TextCell col={f} row={r.id} value={ed.get(r.id, f, saved)} onChange={(v) => ed.set(r.id, f, v, saved)} dirty={ed.isDirty(r.id, f)} error={err(r.id, f)} {...o} />
  );
  const check = (r: Rec, f: string, saved: boolean, label: string) => (
    <CheckCell label={label} checked={ed.get(r.id, f, saved)} onChange={(v) => ed.set(r.id, f, v, saved)} dirty={ed.isDirty(r.id, f)} />
  );
  const seo = (r: Rec) => (r.seo ?? {}) as { title?: string | null; description?: string | null };

  const columns: BulkColumn<TRow>[] = [
    {
      id: "name",
      header: isCat ? "Category name" : "Collection title",
      group: "General",
      width: 260,
      locked: true,
      cell: (row) => (
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">{text(row.rec, "name", nameOf(row.rec))}</div>
          {failed[row.id] ? (
            <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] text-destructive" title={failed[row.id]}>
              Not saved
            </span>
          ) : null}
        </div>
      ),
    },
    { id: "description", header: "Description", group: "General", width: 260, cell: (row) => text(row.rec, "description", row.rec.description ?? "") },
    {
      id: "descriptionJson",
      header: "Long description",
      group: "General",
      width: 200,
      cell: (row) => {
        const saved = richStr(row.rec.descriptionJson);
        const cur = ed.get(row.id, "descriptionJson", saved);
        const initial = cur ? (JSON.parse(cur) as RichDescription).blocks : [];
        const first = initial.length ? JSON.stringify(initial[0]).replace(/<[^>]*>/g, "").slice(0, 80) : "";
        return (
          <PopoverCell title={`Long description: ${nameOf(row.rec)}`} summary={first ? `${initial.length} block${initial.length === 1 ? "" : "s"}` : emptyDash} dirty={ed.isDirty(row.id, "descriptionJson")} wide>
            <PolicyRichEditor
              initialBlocks={row.rec.descriptionJson?.blocks ?? []}
              resetKey={row.id}
              onChange={(blocks) => ed.set(row.id, "descriptionJson", blocks.length ? JSON.stringify({ v: 1, blocks }) : "", saved)}
            />
          </PopoverCell>
        );
      },
    },
    {
      id: "image",
      header: "Featured image",
      group: "General",
      width: 130,
      cell: (row) => {
        const savedId = row.rec.imageMediaId ?? "";
        const curId = ed.get(row.id, "imageMediaId", savedId);
        const url = images[curId] ?? (curId === savedId ? row.rec.imageUrl : null);
        return (
          <button type="button" onClick={() => setPicking(row.id)} aria-label={`Featured image for ${nameOf(row.rec)}`} className={`flex h-7 w-full items-center gap-1.5 rounded-sm border border-transparent px-1.5 hover:border-border ${ed.isDirty(row.id, "imageMediaId") ? "bg-amber-500/10" : ""}`}>
            {url ? <img src={url} alt="" className="size-5 rounded object-cover" /> : <span className="text-muted-foreground">Add image</span>}
          </button>
        );
      },
    },
    { id: "seoTitle", header: "SEO title", group: "SEO", width: 220, cell: (row) => text(row.rec, "seoTitle", seo(row.rec).title ?? "") },
    { id: "seoDescription", header: "Meta description", group: "SEO", width: 260, cell: (row) => text(row.rec, "seoDescription", seo(row.rec).description ?? "") },
    { id: "slug", header: "URL handle", group: "SEO", width: 200, cell: (row) => text(row.rec, "slug", row.rec.slug, { mono: true }) },
    ...(isCat
      ? ([
          { id: "isActive", header: "Active", group: "Visibility", width: 70, cell: (row) => check(row.rec, "isActive", (row.rec as Category).isActive, "Active") },
          { id: "isFeatured", header: "Featured", group: "Visibility", width: 80, cell: (row) => check(row.rec, "isFeatured", (row.rec as Category).isFeatured, "Featured") },
          {
            id: "parentId",
            header: "Parent category",
            group: "Structure",
            width: 180,
            defaultHidden: true,
            cell: (row) => (
              <SelectCell label="Parent category" value={ed.get(row.id, "parentId", (row.rec as Category).parentId ?? "")} onChange={(v) => ed.set(row.id, "parentId", v, (row.rec as Category).parentId ?? "")} options={parentOptions.filter((o) => o.value !== row.id)} dirty={ed.isDirty(row.id, "parentId")} />
            ),
          },
          { id: "position", header: "Position", group: "Structure", width: 80, align: "right", defaultHidden: true, cell: (row) => text(row.rec, "position", String((row.rec as Category).position), { align: "right" }) },
        ] satisfies BulkColumn<TRow>[])
      : ([
          { id: "published", header: "Published", group: "Visibility", width: 80, cell: (row) => check(row.rec, "published", (row.rec as Collection).published, "Published") },
          { id: "indexable", header: "Search engines", group: "Visibility", width: 100, defaultHidden: true, cell: (row) => check(row.rec, "indexable", (row.rec as Collection).indexable, "Allow search engines") },
          {
            id: "sortOrder",
            header: "Sort order",
            group: "Structure",
            width: 160,
            defaultHidden: true,
            cell: (row) => (
              <SelectCell label="Sort order" value={ed.get(row.id, "sortOrder", (row.rec as Collection).sortOrder)} onChange={(v) => ed.set(row.id, "sortOrder", v, (row.rec as Collection).sortOrder)} options={COLLECTION_SORTS} dirty={ed.isDirty(row.id, "sortOrder")} />
            ),
          },
        ] satisfies BulkColumn<TRow>[])),
    { id: "type", header: "Type", group: "Info", width: 90, defaultHidden: true, cell: (row) => <span className="px-1.5 text-muted-foreground capitalize">{row.rec.type}</span> },
    { id: "count", header: "Products", group: "Info", width: 80, align: "right", defaultHidden: true, cell: (row) => <span className="px-1.5 text-muted-foreground tabular-nums">{row.rec.productCount ?? 0}</span> },
  ];

  const hidden = useColumnVisibility(`${kind}-bulk`, columns);
  const shown = columns.filter((c) => c.locked || hidden.isVisible(c.id));
  const rows: TRow[] = recs.map((rec) => ({ id: rec.id, rec }));
  const back = isCat ? "/categories" : "/collections";

  if (ids.length === 0) {
    return (
      <PageContainer size="full">
        <div className="grid justify-items-center gap-2 py-24 text-center">
          <p className="text-sm font-semibold text-foreground">Nothing to edit</p>
          <p className="text-muted-foreground">Open the bulk editor from the {nounPlural} list.</p>
          <Button size="sm" onClick={() => void navigate({ to: back })}>
            Go to {nounPlural}
          </Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="full">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label={`Back to ${nounPlural}`} nativeButton={false} render={<Link to={back} />}>
          <ArrowLeft />
        </Button>
        <h1 className="text-sm font-semibold text-foreground">
          Editing {recs.length || ids.length} {recs.length === 1 ? noun : nounPlural}
        </h1>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="icon" aria-label="Undo" disabled={!ed.canUndo} onClick={ed.undo}>
            <Undo2 />
          </Button>
          <Button variant="outline" size="icon" aria-label="Redo" disabled={!ed.canRedo} onClick={ed.redo}>
            <Redo2 />
          </Button>
          <GridColumnsMenu columns={columns} isVisible={hidden.isVisible} onToggle={hidden.toggle} onReset={hidden.reset} />
        </div>
      </div>

      {ed.count > 0 ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs">
          <span className="font-medium text-foreground">
            {items.length} {items.length === 1 ? noun : nounPlural} changed
          </span>
          {errorCount > 0 ? <span className="text-destructive">{errorCount} cell{errorCount === 1 ? "" : "s"} need fixing</span> : null}
          <div className="ml-auto flex gap-1.5">
            <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => { ed.clear(); setFailed({}); }}>
              <X className="mr-1.5 size-3.5" aria-hidden /> Discard
            </Button>
            <Button size="sm" disabled={save.isPending || errorCount > 0 || items.length === 0} onClick={() => save.mutate()}>
              <Save className="mr-1.5 size-3.5" aria-hidden /> {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : null}

      {list.isLoading ? (
        <TableSkeleton rows={10} columns={6} />
      ) : list.isError ? (
        <p role="alert" className="text-destructive">{errorMessage(list.error)}</p>
      ) : (
        <BulkGrid columns={shown} rows={rows} collapsed={new Set<string>()} onToggleCollapsed={() => undefined} className="max-h-[calc(100dvh-12rem)]" empty={<p className="py-16 text-center text-muted-foreground">These {nounPlural} could not be found.</p>} />
      )}

      <MediaPickerDialog
        open={picking !== null}
        onOpenChange={(o) => !o && setPicking(null)}
        accept={["image"]}
        multiple={false}
        title="Select featured image"
        onSelect={(sel) => {
          const m = sel[0];
          const target = recs.find((r) => r.id === picking);
          if (!m || !target) return;
          const picked = m.url;
          if (picked) setImages((cur) => ({ ...cur, [m.id]: picked }));
          ed.set(target.id, "imageMediaId", m.id, target.imageMediaId ?? "");
        }}
      />
    </PageContainer>
  );
}

export type { ReactNode };
