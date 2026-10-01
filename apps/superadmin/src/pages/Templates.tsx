import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Pencil, Plus } from "lucide-react";
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

export function Templates() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: templates, isLoading, isError, error } = useQuery(orpc.templates.list.queryOptions());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
  const fail = (what: string) => (err: Error) => toast.error(`Could not ${what}: ${err.message}`);

  const create = useMutation({
    mutationFn: () => client.templates.create({ name: name.trim(), ...(cloneFrom ? { cloneFromCode: cloneFrom } : {}) }),
    onSuccess: async (t) => {
      setCreating(false);
      setName("");
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
  const setActive = useMutation({
    mutationFn: (v: { code: string; isActive: boolean }) => client.templates.updateMeta(v),
    onSuccess: refresh,
    onError: fail("update theme"),
  });

  if (isLoading) return <PageSkeleton />;

  return (
    <PageContainer>
      <PageHeader
        title="Themes"
        description="Pre-built themes stores can activate from their dashboard. Build each one visually, preview it, then publish it to the store theme library."
        aside={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 size-3.5" aria-hidden />
            New theme
          </Button>
        }
      />

      {isError ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          Could not load themes: {error.message}
        </div>
      ) : !templates || templates.length === 0 ? (
        <EmptyState icon={Layers} title="No themes yet" description="Create the first theme to offer stores." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Theme</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.code}>
                  <TableCell className="text-xs">
                    <div className="font-semibold">{t.name}</div>
                    {t.description ? <div className="max-w-md text-muted-foreground">{t.description}</div> : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{t.code}</TableCell>
                  <TableCell className="font-mono text-xs">v{t.version}</TableCell>
                  <TableCell className="text-xs">
                    <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${t.isActive ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                      {t.isActive ? "Published" : "Hidden from stores"}
                    </span>
                    {t.hasUnpublishedChanges ? (
                      <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700">Unpublished changes</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" onClick={() => void navigate({ to: "/templates/$code/editor", params: { code: t.code } })}>
                        <Pencil className="mr-1.5 size-3.5" aria-hidden />
                        Edit
                      </Button>
                      {!t.isActive || t.hasUnpublishedChanges ? (
                        <Button size="sm" variant="primary" loading={publish.isPending && publish.variables === t.code} onClick={() => publish.mutate(t.code)}>
                          Publish
                        </Button>
                      ) : null}
                      {t.isActive ? (
                        <Button size="sm" onClick={() => setActive.mutate({ code: t.code, isActive: false })}>
                          Hide
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
            <DialogDescription>It starts hidden from stores until you publish it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label htmlFor="theme-name">Name</Label>
              <Input id="theme-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="theme-clone">Start from</Label>
              <select id="theme-clone" value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="">Blank page</option>
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
    </PageContainer>
  );
}
