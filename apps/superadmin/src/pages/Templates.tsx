import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Layers, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
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
  Input,
  Label,
  PageContainer,
  PageHeader,
  PageSkeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@bs/ui";
import { client, orpc } from "../lib/orpc.ts";

type Tab = "published" | "draft" | "archived";
const TABS: ReadonlyArray<{ key: Tab; label: string; empty: string }> = [
  { key: "published", label: "Published", empty: "No published themes. Publish a draft to offer it to stores." },
  { key: "draft", label: "Drafts", empty: "No drafts. Use New theme to start building one." },
  { key: "archived", label: "Archive", empty: "Nothing archived. Archiving a published theme moves it here and hides it from stores." },
];

const INDUSTRIES = ["general", "fashion", "food", "beauty", "electronics", "home", "other"];

export function Templates() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: templates, isLoading, isError, error } = useQuery(orpc.templates.list.queryOptions());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const [industry, setIndustry] = useState("general");
  const [description, setDescription] = useState("");
  // Library card details of an existing theme (name, description, industry).
  const [editing, setEditing] = useState<{ code: string; name: string; description: string; industry: string } | null>(null);

  const [tab, setTab] = useState<Tab>("published");
  const [deleting, setDeleting] = useState<{ code: string; name: string } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
  const fail = (what: string) => (err: Error) => toast.error(`Could not ${what}: ${err.message}`);

  const create = useMutation({
    mutationFn: () => client.templates.create({
        name: name.trim(),
        industry,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(cloneFrom ? { cloneFromCode: cloneFrom } : {}),
      }),
    onSuccess: async (t) => {
      setCreating(false);
      setName("");
      setDescription("");
      await refresh();
      void navigate({ to: "/templates/$code/editor", params: { code: t.code } });
    },
    onError: fail("create theme"),
  });
  const publish = useMutation({
    mutationFn: (code: string) => client.templates.publish({ code }),
    onSuccess: async (r) => {
      toast.success(`Published as version ${r.version}. Stores keep their own customised copy.`);
      await refresh();
    },
    onError: fail("publish theme"),
  });
  const saveDetails = useMutation({
    mutationFn: (v: { code: string; name: string; description: string; industry: string }) =>
      client.templates.updateMeta({ code: v.code, name: v.name.trim(), description: v.description.trim() || null, industry: v.industry }),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
    onError: fail("save details"),
  });
  const remove = useMutation({
    mutationFn: (code: string) => client.templates.delete({ code }),
    onSuccess: async () => {
      toast.success("Theme deleted. Stores that already used it keep their own copy.");
      setDeleting(null);
      await refresh();
    },
    onError: fail("delete theme"),
  });
  const setArchived = useMutation({
    mutationFn: (v: { code: string; archived: boolean }) => client.templates.updateMeta(v),
    onSuccess: async (_t, v) => {
      toast.success(v.archived ? "Archived. It is hidden from stores; stores that use it keep their copy." : "Moved back to Drafts.");
      await refresh();
    },
    onError: fail("update theme"),
  });

  if (isLoading) return <PageSkeleton />;

  const visible = (templates ?? []).filter((t) => t.status === tab);

  return (
    <PageContainer>
      <PageHeader
        title="Themes"
        description="Themes stores can pick from their dashboard. Each theme has its own colours, fonts, buttons, corners and layouts for the home, collection, product and cart pages, header and footer. Build it visually, then publish it to the store theme library."
        aside={
          <Button variant="primary" size="sm" onClick={() => { setTab("draft"); setCreating(true); }}>
            <Plus className="mr-1.5 size-3.5" aria-hidden />
            New theme
          </Button>
        }
      />

      <div role="tablist" aria-label="Theme status" className="mb-4 flex gap-1 border-b">
        {TABS.map((t) => {
          const count = (templates ?? []).filter((x) => x.status === t.key).length;
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t.label} <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-xs">{count}</span>
            </button>
          );
        })}
      </div>

      {isError ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          Could not load themes: {error.message}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={Layers} title={`No ${TABS.find((x) => x.key === tab)?.label.toLowerCase()} themes`} description={TABS.find((x) => x.key === tab)?.empty ?? ""} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Theme</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((t) => (
                <TableRow key={t.code}>
                  <TableCell className="text-xs">
                    <div className="font-semibold">{t.name}</div>
                    {t.description ? <div className="max-w-md text-muted-foreground">{t.description}</div> : null}
                  </TableCell>
                  <TableCell className="text-xs capitalize">{t.industry}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{t.code}</TableCell>
                  <TableCell className="font-mono text-xs">v{t.version}</TableCell>
                  <TableCell className="text-xs">
                    <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${t.status === "published" ? "bg-emerald-500/10 text-emerald-700" : t.status === "draft" ? "bg-amber-500/10 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                      {t.status === "published" ? "Published" : t.status === "draft" ? "Draft: hidden from stores" : "Archived: hidden from stores"}
                    </span>
                    {t.status === "published" && t.hasUnpublishedChanges ? (
                      <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700">Unpublished changes</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" onClick={() => void navigate({ to: "/templates/$code/editor", params: { code: t.code } })}>
                        <Pencil className="mr-1.5 size-3.5" aria-hidden />
                        Edit
                      </Button>
                      <Button size="sm" onClick={() => setEditing({ code: t.code, name: t.name, description: t.description ?? "", industry: t.industry })}>
                        <Settings2 className="mr-1.5 size-3.5" aria-hidden />
                        Details
                      </Button>
                      {!t.isActive || t.hasUnpublishedChanges ? (
                        <Button size="sm" variant="primary" loading={publish.isPending && publish.variables === t.code} onClick={() => publish.mutate(t.code)}>
                          Publish
                        </Button>
                      ) : null}
                      {t.status === "published" ? (
                        <Button size="sm" loading={setArchived.isPending && setArchived.variables?.code === t.code} onClick={() => setArchived.mutate({ code: t.code, archived: true })}>
                          <Archive className="mr-1.5 size-3.5" aria-hidden />
                          Archive
                        </Button>
                      ) : null}
                      {t.status === "archived" ? (
                        <Button size="sm" onClick={() => setArchived.mutate({ code: t.code, archived: false })}>
                          Move to drafts
                        </Button>
                      ) : null}
                      {t.status !== "published" ? (
                        <Button size="sm" onClick={() => setDeleting({ code: t.code, name: t.name })}>
                          <Trash2 className="mr-1.5 size-3.5" aria-hidden />
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New theme</DialogTitle>
            <DialogDescription>It starts as a draft, hidden from stores until you publish it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label htmlFor="theme-name">Name</Label>
              <Input id="theme-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="theme-industry">Best for</Label>
              <select id="theme-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i[0]?.toUpperCase()}
                    {i.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="theme-desc">Short description (shown to stores)</Label>
              <Input id="theme-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="theme-clone">Start from</Label>
              <select id="theme-clone" value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="">Starter layout (all pages)</option>
                {(templates ?? []).map((t) => (
                  <option key={t.code} value={t.code}>
                    Copy of {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button variant="primary" loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>
              Create and open editor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete theme</DialogTitle>
            <DialogDescription>
              {deleting ? `Permanently delete "${deleting.name}"? Its layouts and draft are removed and cannot be recovered. Stores that already activated it keep their own copy of the pages and settings; they just can no longer pick it from the library.` : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button variant="primary" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.code)}>
              Delete theme
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Theme details</DialogTitle>
            <DialogDescription>How the theme appears in each store's theme library.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="grid gap-3">
              <div className="grid gap-1">
                <Label htmlFor="edit-name">Name</Label>
                <Input id="edit-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="edit-industry">Best for</Label>
                <select id="edit-industry" value={editing.industry} onChange={(e) => setEditing({ ...editing, industry: e.target.value })} className="h-9 rounded-md border bg-background px-2 text-sm">
                  {[...new Set([...INDUSTRIES, editing.industry])].map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="edit-desc">Short description</Label>
                <Input id="edit-desc" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} maxLength={500} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button variant="primary" loading={saveDetails.isPending} disabled={!editing?.name.trim()} onClick={() => editing && saveDetails.mutate(editing)}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
