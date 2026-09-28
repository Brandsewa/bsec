import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  FilePlus,
  FileText,
  History,
  Layers,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

import { useState } from "react";

import {
  Button,
  DataTable,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FilterBar,
  Input,
  Label,
  MetricCard,
  MetricCardSkeleton,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  TableSkeleton,
  toast,
  type ColumnDef,
} from "@bs/ui";

interface BlockItem {
  id: string;
  type: string;
  name: string;
  summary: string;
}

interface PageItem {
  id: string;
  title: string;
  slug: string;
  status: "published" | "draft";
  version: number;
  blocks: BlockItem[];
  updatedAt: string;
}

const AVAILABLE_BLOCK_TYPES = [
  { type: "hero", name: "Hero Banner", description: "Headline, description, CTA button and background image" },
  { type: "featured_products", name: "Featured Products", description: "Curated row of highlighted items" },
  { type: "product_grid", name: "Product Grid", description: "Paginated grid of collection products" },
  { type: "text", name: "Text Section", description: "Structured headings and paragraph copy" },
  { type: "image_banner", name: "Image Banner", description: "Full-width visual banner with overlay text" },
  { type: "testimonials", name: "Testimonials", description: "Customer reviews with ratings and quotes" },
  { type: "newsletter", name: "Newsletter Signup", description: "Email capture form with incentive copy" },
  { type: "rich_text", name: "Rich Text", description: "Markdown or HTML formatted content block" },
  { type: "contact_form", name: "Contact Form", description: "Customer inquiry form with custom fields" },
  { type: "faq", name: "FAQ Accordion", description: "Expandable questions and answers" },
  { type: "video", name: "Video Embed", description: "Responsive video player with poster" },
  { type: "banner", name: "Announcement Banner", description: "Top or floating notification bar" },
];

const initialPages: PageItem[] = [
  {
    id: "page-1",
    title: "Home",
    slug: "home",
    status: "published",
    version: 3,
    blocks: [
      { id: "b1", type: "banner", name: "Announcement Banner", summary: "Free shipping across Nepal on orders above ₹2000" },
      { id: "b2", type: "hero", name: "Hero Banner", summary: "Handcrafted comfort, sustainable living" },
      { id: "b3", type: "featured_products", name: "Featured Products", summary: "Top 4 selling items this week" },
      { id: "b4", type: "testimonials", name: "Testimonials", summary: "Verified reviews from Kathmandu & Pokhara" },
      { id: "b5", type: "newsletter", name: "Newsletter", summary: "Get 10% off your first purchase" },
    ],
    updatedAt: "2026-09-28 14:30",
  },
  {
    id: "page-2",
    title: "About Us",
    slug: "about-us",
    status: "published",
    version: 2,
    blocks: [
      { id: "b6", type: "hero", name: "Hero Banner", summary: "Our Story & Artisan Heritage" },
      { id: "b7", type: "rich_text", name: "Rich Text", summary: "Mission, craftsmanship, and local sourcing" },
    ],
    updatedAt: "2026-09-27 11:15",
  },
  {
    id: "page-3",
    title: "Summer 2026 Lookbook",
    slug: "summer-lookbook",
    status: "draft",
    version: 1,
    blocks: [
      { id: "b8", type: "image_banner", name: "Image Banner", summary: "Summer campaign editorial visuals" },
      { id: "b9", type: "product_grid", name: "Product Grid", summary: "Summer linen collection (8 items)" },
    ],
    updatedAt: "2026-09-28 15:40",
  },
];

let pageCounter = 100;
function getNextPageId() {
  return `page-${++pageCounter}`;
}

let blockCounter = 100;
function getNextBlockId() {
  return `b-${++blockCounter}`;
}

export const Route = createFileRoute("/_store/online-store/pages")({
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <TableSkeleton rows={6} columns={5} />
    </PageSkeleton>
  ),
  component: PagesManagement,
});

function PagesManagement() {
  const [pages, setPages] = useState<PageItem[]>(initialPages);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedPageId, setSelectedPageId] = useState<string | null>(initialPages[0]?.id ?? null);
  const [isNewPageOpen, setIsNewPageOpen] = useState(false);
  const [isAddBlockOpen, setIsAddBlockOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");

  const activePage = pages.find((p) => p.id === selectedPageId) ?? pages[0];

  const filteredPages = pages.filter((page) => {
    if (search.trim() && !page.title.toLowerCase().includes(search.toLowerCase()) && !page.slug.includes(search)) {
      return false;
    }
    if (statusFilter !== "all" && page.status !== statusFilter) {
      return false;
    }
    return true;
  });

  const handleCreatePage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const generatedSlug = newSlug.trim() || newTitle.toLowerCase().replace(/\s+/g, "-");
    const newPage: PageItem = {
      id: getNextPageId(),
      title: newTitle.trim(),
      slug: generatedSlug,
      status: "draft",
      version: 1,
      blocks: [{ id: getNextBlockId(), type: "hero", name: "Hero Banner", summary: `Welcome to ${newTitle}` }],
      updatedAt: "Just now",
    };
    setPages((prev) => [newPage, ...prev]);
    setSelectedPageId(newPage.id);
    setIsNewPageOpen(false);
    setNewTitle("");
    setNewSlug("");
    toast.success(`Created page "${newPage.title}"`);
  };

  const handleAddBlock = (blockType: (typeof AVAILABLE_BLOCK_TYPES)[number]) => {
    if (!activePage) return;
    const newBlock: BlockItem = {
      id: getNextBlockId(),
      type: blockType.type,
      name: blockType.name,
      summary: blockType.description,
    };
    setPages((prev) =>
      prev.map((p) => (p.id === activePage.id ? { ...p, blocks: [...p.blocks, newBlock] } : p))
    );
    setIsAddBlockOpen(false);
    toast.success(`Added ${blockType.name} block`);
  };


  const handleMoveBlock = (index: number, direction: "up" | "down") => {
    if (!activePage) return;
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= activePage.blocks.length) return;

    const newBlocks = [...activePage.blocks];
    const temp = newBlocks[index];
    const target = newBlocks[targetIdx];
    if (temp && target) {
      newBlocks[index] = target;
      newBlocks[targetIdx] = temp;
      setPages((prev) =>
        prev.map((p) => (p.id === activePage.id ? { ...p, blocks: newBlocks } : p))
      );
    }
  };

  const handleRemoveBlock = (blockId: string) => {
    if (!activePage) return;
    setPages((prev) =>
      prev.map((p) =>
        p.id === activePage.id
          ? { ...p, blocks: p.blocks.filter((b) => b.id !== blockId) }
          : p
      )
    );
    toast.info("Block removed from page");
  };

  const handlePublishPage = () => {
    if (!activePage) return;
    setPages((prev) =>
      prev.map((p) =>
        p.id === activePage.id
          ? { ...p, status: "published", version: p.version + 1, updatedAt: "Just now" }
          : p
      )
    );
    toast.success(`Published version ${activePage.version + 1} of "${activePage.title}"`);
  };

  const handleRollback = () => {
    if (!activePage) return;
    if (activePage.version <= 1) {
      toast.warning("Cannot rollback: already at earliest version v1.");
      return;
    }
    setPages((prev) =>
      prev.map((p) =>
        p.id === activePage.id
          ? { ...p, version: p.version - 1, updatedAt: "Rolled back" }
          : p
      )
    );
    toast.info(`Rolled back "${activePage.title}" to version ${activePage.version - 1}`);
  };

  const columns: ColumnDef<PageItem>[] = [
    {
      header: "Page Title",
      cell: (p) => (
        <div className="flex flex-col">
          <span className="font-semibold text-foreground">{p.title}</span>
          <span className="text-xs text-foreground-lighter">/{p.slug}</span>
        </div>
      ),
    },
    {
      header: "Status",
      cell: (p) => (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
            p.status === "published"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          }`}
        >
          {p.status}
        </span>
      ),
    },
    {
      header: "Version",
      cell: (p) => <span className="font-mono text-xs text-foreground-muted">v{p.version}</span>,
    },
    {
      header: "Blocks",
      cell: (p) => (
        <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
          <Layers className="size-3.5" />
          {p.blocks.length} blocks
        </span>
      ),
    },
    {
      header: "Last Updated",
      className: "text-right",
      headerClassName: "text-right",
      cell: (p) => <span className="text-xs text-foreground-lighter">{p.updatedAt}</span>,
    },
  ];

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Online Store", href: "/online-store/theme" }, { label: "Pages" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setIsNewPageOpen(true)}>
              <FilePlus className="mr-1.5 size-3.5" aria-hidden />
              Add page
            </Button>
          </div>
        }
      />

      <PageHeader
        title="Pages & Block Layouts"
        description="Build and organize storefront content using 12 validated, versioned block types."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total Pages" value={pages.length} icon={FileText} />
        <MetricCard
          label="Published"
          value={pages.filter((p) => p.status === "published").length}
          change={{ value: "+1", trend: "up" }}
        />
        <MetricCard
          label="Drafts"
          value={pages.filter((p) => p.status === "draft").length}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: Pages List */}
        <div className="space-y-4 lg:col-span-5">
          <PageSection title="All Pages">
            <div className="space-y-3">
              <FilterBar
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search pages..."
                hasActiveFilters={statusFilter !== "all" || search.length > 0}
                onReset={() => {
                  setSearch("");
                  setStatusFilter("all");
                }}
              />

              <DataTable
                data={filteredPages}
                columns={columns}
                keyExtractor={(p) => p.id}
                onRowClick={(p) => setSelectedPageId(p.id)}
                emptyTitle="No pages found"
                emptyDescription="Create your first content page."
              />
            </div>
          </PageSection>
        </div>

        {/* Right: Selected Page Block Editor */}
        <div className="space-y-4 lg:col-span-7">
          {activePage ? (
            <PageSection
              title={`Editing: ${activePage.title} (v${activePage.version})`}
              description={`URL: /${activePage.slug}`}
              actions={
                <div className="flex items-center gap-2">
                  <Button variant="default" size="sm" onClick={handleRollback}>
                    <History className="mr-1.5 size-3.5" aria-hidden />
                    Rollback
                  </Button>
                  <Button variant="primary" size="sm" onClick={handlePublishPage}>
                    <Upload className="mr-1.5 size-3.5" aria-hidden />
                    Publish v{activePage.version + 1}
                  </Button>
                </div>
              }
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                    Page Blocks ({activePage.blocks.length})
                  </span>
                  <Button variant="default" size="sm" onClick={() => setIsAddBlockOpen(true)}>
                    <Plus className="mr-1 size-3" />
                    Insert Block
                  </Button>
                </div>

                {activePage.blocks.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-8 text-center">
                    <p className="text-sm text-foreground-muted">This page has no blocks yet.</p>
                    <Button variant="default" size="sm" className="mt-3" onClick={() => setIsAddBlockOpen(true)}>
                      Add First Block
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activePage.blocks.map((block, index) => (
                      <div
                        key={block.id}
                        className="flex items-center justify-between rounded-lg border border-border bg-surface-50 p-3 transition-colors hover:border-foreground-muted/40"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex size-6 items-center justify-center rounded bg-surface-200 text-xs font-bold text-foreground-muted">
                            {index + 1}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-foreground">{block.name}</span>
                              <span className="rounded bg-surface-200 px-1.5 py-0.5 font-mono text-[10px] text-foreground-lighter">
                                {block.type}
                              </span>
                            </div>
                            <p className="text-xs text-foreground-lighter">{block.summary}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={index === 0}
                            onClick={() => handleMoveBlock(index, "up")}
                            title="Move Up"
                          >
                            <ArrowUp className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={index === activePage.blocks.length - 1}
                            onClick={() => handleMoveBlock(index, "down")}
                            title="Move Down"
                          >
                            <ArrowDown className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveBlock(block.id)}
                            title="Remove Block"
                          >
                            <Trash2 className="size-3.5 text-rose-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </PageSection>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-12 text-center text-foreground-muted">
              Select a page to view and edit its block structure.
            </div>
          )}
        </div>
      </div>

      {/* Add Page Dialog */}
      <Dialog open={isNewPageOpen} onOpenChange={setIsNewPageOpen}>
        <DialogContent>
          <form onSubmit={handleCreatePage}>
            <DialogHeader>
              <DialogTitle>Create New Page</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-1">
                <Label htmlFor="pageTitle">Page Title</Label>
                <Input
                  id="pageTitle"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Terms of Service, Summer Sale"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pageSlug">URL Slug (optional)</Label>
                <Input
                  id="pageSlug"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  placeholder="e.g. terms-of-service"
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="default" type="button">
                  Cancel
                </Button>
              </DialogClose>
              <Button variant="primary" type="submit">
                Create Page
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Insert Block Dialog */}
      <Dialog open={isAddBlockOpen} onOpenChange={setIsAddBlockOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Insert Block Type</DialogTitle>
          </DialogHeader>
          <div className="grid max-h-96 gap-2 overflow-y-auto py-2 sm:grid-cols-2">
            {AVAILABLE_BLOCK_TYPES.map((bt) => (
              <button
                key={bt.type}
                type="button"
                onClick={() => handleAddBlock(bt)}
                className="flex flex-col rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <span className="text-sm font-semibold text-foreground">{bt.name}</span>
                <span className="font-mono text-[10px] text-foreground-lighter">{bt.type}</span>
                <p className="mt-1 text-xs text-foreground-muted line-clamp-2">{bt.description}</p>
              </button>
            ))}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="default" type="button">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
