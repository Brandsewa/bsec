import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Edit2, Filter, Menu as MenuIcon, Plus, Trash2 } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSkeleton,
  SimpleSelect,
  TableSkeleton,
  toast,
} from "@bs/ui";
import type { Menu } from "@bs/contracts";
import { DataTable, type Column } from "../../../components/data-table/data-table.tsx";
import { TableToolbar } from "../../../components/data-table/table-toolbar.tsx";
import { errorMessage } from "../../../lib/errors.ts";
import { orpc } from "../../../lib/orpc.ts";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function MenusLoading() {
  return (
    <PageSkeleton>
      <TableSkeleton rows={6} columns={6} />
    </PageSkeleton>
  );
}

export const Route = createFileRoute("/_store/online-store/menus")({
  pendingComponent: MenusLoading,
  component: MenusPage,
});

export function MenusPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addHandle, setAddHandle] = useState("");
  const [addKind, setAddKind] = useState<"navigation" | "filter">("navigation");
  const [handleEdited, setHandleEdited] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Menu | null>(null);

  const menusQuery = useQuery(orpc.admin.menus.list.queryOptions());
  const rawMenus = useMemo(() => menusQuery.data ?? [], [menusQuery.data]);

  const createMutation = useMutation(
    orpc.admin.menus.create.mutationOptions({
      onSuccess: async (created) => {
        toast.success(`Menu "${created.name}" created`);
        await queryClient.invalidateQueries({ queryKey: orpc.admin.menus.list.key() });
        setIsAddOpen(false);
        setAddName("");
        setAddHandle("");
        setHandleEdited(false);
        navigate({
          to: "/online-store/menus/$handle",
          params: { handle: created.handle },
        });
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  const deleteMutation = useMutation(
    orpc.admin.menus.delete.mutationOptions({
      onSuccess: async () => {
        toast.success("Menu deleted");
        await queryClient.invalidateQueries({ queryKey: orpc.admin.menus.list.key() });
        setDeleteTarget(null);
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  const handleNameChange = (val: string) => {
    setAddName(val);
    if (!handleEdited) {
      setAddHandle(slugify(val));
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = addName.trim();
    const handle = addHandle.trim();
    if (!name) {
      toast.error("Please enter a menu title");
      return;
    }
    if (!handle) {
      toast.error("Please enter a menu handle");
      return;
    }

    createMutation.mutate({
      name,
      handle,
      kind: addKind,
      items: [],
    });
  };

  const filteredMenus = useMemo(() => {
    return rawMenus.filter((m) => {
      if (kindFilter !== "all" && m.kind !== kindFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchesName = m.name.toLowerCase().includes(q);
        const matchesHandle = m.handle.toLowerCase().includes(q);
        if (!matchesName && !matchesHandle) return false;
      }
      return true;
    });
  }, [rawMenus, kindFilter, search]);

  const columns: Column<Menu>[] = [
    {
      id: "name",
      header: "Title",
      cell: (m) => (
        <div className="flex items-center gap-2">
          <span
            className="font-medium text-foreground hover:underline cursor-pointer"
            onClick={() =>
              navigate({
                to: "/online-store/menus/$handle",
                params: { handle: m.handle },
              })
            }
          >
            {m.name}
          </span>
          {m.isProtected ? (
            <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">
              Default
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      id: "handle",
      header: "Handle",
      className: "font-mono text-xs text-muted-foreground",
      cell: (m) => <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">{m.handle}</code>,
    },
    {
      id: "kind",
      header: "Kind",
      cell: (m) => (
        <Badge variant={m.kind === "filter" ? "secondary" : "default"} className="capitalize">
          {m.kind === "filter" ? (
            <span className="flex items-center gap-1">
              <Filter className="h-3 w-3" />
              Filter
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <MenuIcon className="h-3 w-3" />
              Navigation
            </span>
          )}
        </Badge>
      ),
    },
    {
      id: "items",
      header: "Items",
      className: "text-sm text-muted-foreground",
      cell: (m) => (
        <span>
          {m.itemCount ?? 0} {m.itemCount === 1 ? "item" : "items"}
        </span>
      ),
    },
    {
      id: "usedIn",
      header: "Used in",
      cell: (m) => {
        const used = m.usedIn ?? [];
        if (used.length === 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {used.map((u) => (
              <Badge key={u} variant="outline" className="text-xs font-normal">
                {u}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      id: "updated",
      header: "Updated",
      className: "text-xs text-muted-foreground",
      cell: (m) => {
        const date = new Date(m.updatedAt);
        return (
          <span>
            {date.toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      className: "text-right",
      cell: (m) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              navigate({
                to: "/online-store/menus/$handle",
                params: { handle: m.handle },
              })
            }
          >
            <Edit2 className="h-4 w-4 mr-1" />
            Edit
          </Button>
          {!m.isProtected ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteTarget(m)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled
              title="Default menu is protected and cannot be deleted"
              className="text-muted-foreground opacity-40 cursor-not-allowed"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageBreadcrumbs
        items={[
          { label: "Online Store" },
          { label: "Navigation" },
        ]}
        actions={
          <Button size="sm" onClick={() => setIsAddOpen(true)}>
            <Plus className="mr-1.5 size-3.5" />
            Add menu
          </Button>
        }
      />

      <PageHeader
        title="Navigation"
        description="Build storefront menus and product filter collections."
      />

      <div className="mt-6 flex flex-col gap-4">
        <TableToolbar
          searchLabel="Search menus"
          searchPlaceholder="Search menus by title or handle..."
          searchText={search}
          onSearchText={setSearch}
          resultCount={filteredMenus.length}
          noun="menus"
          filters={
            <div className="flex items-center gap-2">
              <SimpleSelect
                ariaLabel="Filter by kind"
                className="w-36"
                value={kindFilter}
                options={[
                  { value: "all", label: "All kinds" },
                  { value: "navigation", label: "Navigation" },
                  { value: "filter", label: "Filter" },
                ]}
                onChange={(v) => setKindFilter(v)}
              />
            </div>
          }
        />

        <DataTable
          columns={columns}
          rows={filteredMenus}
          getRowId={(m) => m.id}
          isLoading={menusQuery.isLoading}
          empty={
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <p className="text-base font-medium">No menus found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {search || kindFilter !== "all"
                  ? "Try adjusting your search or filters."
                  : "Create navigation menus for headers and footers or filter menus for catalog browsing."}
              </p>
              {!search && kindFilter === "all" && (
                <Button size="sm" className="mt-4" onClick={() => setIsAddOpen(true)}>
                  <Plus className="mr-1.5 size-3.5" />
                  Add menu
                </Button>
              )}
            </div>
          }
        />
      </div>

      {/* Add Menu Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateSubmit}>
            <DialogHeader>
              <DialogTitle>Add Menu</DialogTitle>
              <DialogDescription>
                Create a navigation menu for links or a filter menu for faceted collection browsing.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="menu-name">Title</Label>
                <Input
                  id="menu-name"
                  placeholder="e.g. Main menu or Catalog filters"
                  value={addName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="menu-handle">Handle</Label>
                <Input
                  id="menu-handle"
                  placeholder="e.g. main-menu"
                  value={addHandle}
                  onChange={(e) => {
                    setHandleEdited(true);
                    setAddHandle(slugify(e.target.value));
                  }}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Unique identifier used by theme blocks to reference this menu.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="menu-kind">Kind</Label>
                <SimpleSelect
                  value={addKind}
                  onChange={(val) => setAddKind(val as "navigation" | "filter")}
                  options={[
                    { value: "navigation", label: "Navigation (links, pages, nested tree)" },
                    { value: "filter", label: "Filter (faceted collection shop filters)" },
                  ]}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create menu"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete menu "${deleteTarget?.name}"?`}
        description="Are you sure you want to delete this menu? Blocks referencing this handle will fall back to default links."
        confirmLabel="Delete menu"
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ id: deleteTarget.id });
          }
        }}
      />
    </PageContainer>
  );
}
