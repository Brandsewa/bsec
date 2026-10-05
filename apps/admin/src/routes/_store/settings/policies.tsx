import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Eye, History, Plus, RotateCcw, Trash2 } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Button } from "@bs/ui";
import { Input } from "@bs/ui";
import { SimpleSelect } from "../../../components/simple-select.tsx";
import { ConfirmDialog } from "../../../components/confirm-dialog.tsx";
import { SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import type { PolicyBlock, PolicyDetail, PolicyHandle } from "@bs/contracts";

export const Route = createFileRoute("/_store/settings/policies")({
  pendingComponent: () => <PageSkeleton />,
  component: PoliciesSettingsPage,
});

const TITLE = "Policies";
const DESCRIPTION = "Manage store terms, privacy policies, refund terms, and shipping guidelines.";

const POLICY_HANDLES: { handle: PolicyHandle; label: string; description: string }[] = [
  { handle: "refund", label: "Refund policy", description: "Return rules, timelines, and refund terms" },
  { handle: "privacy", label: "Privacy policy", description: "Customer data collection and processing terms" },
  { handle: "terms", label: "Terms of service", description: "Store rules, account conditions, and checkout terms" },
  { handle: "shipping", label: "Shipping policy", description: "Delivery estimates, carriers, and rates" },
  { handle: "legal_notice", label: "Legal notice", description: "Merchant entity details and corporate disclosures" },
];

export function PoliciesSettingsPage() {
  const query = useQuery(orpc.admin.policies.list.queryOptions());
  const [selectedHandle, setSelectedHandle] = useState<PolicyHandle>("refund");

  if (query.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <FormSkeleton />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load store policies"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-3">
        {POLICY_HANDLES.map((p) => {
          const item = query.data.find((x) => x.handle === p.handle);
          const isSelected = selectedHandle === p.handle;
          return (
            <button
              key={p.handle}
              type="button"
              onClick={() => setSelectedHandle(p.handle)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              <span>{p.label}</span>
              {item?.publishedVersion ? (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${isSelected ? "bg-primary-foreground/20 text-primary-foreground" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"}`}>
                  v{item.publishedVersion}
                </span>
              ) : (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${isSelected ? "bg-primary-foreground/20 text-primary-foreground" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}>
                  Draft
                </span>
              )}
            </button>
          );
        })}
      </div>

      <PolicyEditor handle={selectedHandle} onListRefetch={() => void query.refetch()} />
    </SettingsPageFrame>
  );
}

function PolicyEditor({ handle, onListRefetch }: { handle: PolicyHandle; onListRefetch: () => void }) {
  const policyQuery = useQuery(orpc.admin.policies.get.queryOptions({ input: { handle } }));

  if (policyQuery.isLoading) {
    return (
      <SettingsSection>
        <FormSkeleton />
      </SettingsSection>
    );
  }

  if (policyQuery.isError || !policyQuery.data) {
    return (
      <SettingsSection>
        <EmptyState
          icon={AlertTriangle}
          title="Could not load policy details"
          description={errorMessage(policyQuery.error)}
          action={<Button onClick={() => void policyQuery.refetch()}>Try again</Button>}
        />
      </SettingsSection>
    );
  }

  return (
    <PolicyForm
      key={policyQuery.data.id}
      policy={policyQuery.data}
      onSaved={() => {
        void policyQuery.refetch();
        onListRefetch();
      }}
    />
  );
}

function PolicyForm({ policy, onSaved }: { policy: PolicyDetail; onSaved: () => void }) {
  const [title, setTitle] = useState(policy.title);
  const [blocks, setBlocks] = useState<PolicyBlock[]>(policy.draftContent.blocks);
  const [savedSnapshot, setSavedSnapshot] = useState(JSON.stringify({ title: policy.title, blocks: policy.draftContent.blocks }));
  const [showVersions, setShowVersions] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  const dirty = JSON.stringify({ title, blocks }) !== savedSnapshot;
  useUnsavedGuard(dirty);

  // Versions query
  const versionsQuery = useQuery(
    orpc.admin.policies.versions.queryOptions({ input: { handle: policy.handle } }),
  );

  const saveDraftMutation = useMutation(
    orpc.admin.policies.saveDraft.mutationOptions({
      onSuccess: (data) => {
        setSavedSnapshot(JSON.stringify({ title: data.title, blocks: data.draftContent.blocks }));
        toast.success("Draft saved successfully");
        onSaved();
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  const publishMutation = useMutation(
    orpc.admin.policies.publish.mutationOptions({
      onSuccess: (data) => {
        setShowPublishDialog(false);
        setSavedSnapshot(JSON.stringify({ title: data.title, blocks: data.draftContent.blocks }));
        toast.success(`Policy published as version ${data.publishedVersion?.version ?? 1}`);
        onSaved();
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  const restoreDraftMutation = useMutation(
    orpc.admin.policies.restoreDraft.mutationOptions({
      onSuccess: (data) => {
        setTitle(data.title);
        setBlocks(data.draftContent.blocks);
        setSavedSnapshot(JSON.stringify({ title: data.title, blocks: data.draftContent.blocks }));
        toast.success("Restored version to draft");
        onSaved();
      },
      onError: (err) => {
        toast.error(errorMessage(err));
      },
    }),
  );

  const handleAddBlock = (type: "paragraph" | "heading" | "list" | "divider") => {
    if (type === "divider") {
      setBlocks([...blocks, { type: "divider" }]);
    } else if (type === "heading") {
      setBlocks([...blocks, { type: "heading", level: 2, text: "Heading" }]);
    } else if (type === "paragraph") {
      setBlocks([...blocks, { type: "paragraph", text: "Paragraph content here..." }]);
    } else if (type === "list") {
      setBlocks([...blocks, { type: "list", style: "unordered", items: ["Item 1", "Item 2"] }]);
    }
  };

  const handleUpdateBlock = (index: number, updated: PolicyBlock) => {
    const next = [...blocks];
    next[index] = updated;
    setBlocks(next);
  };

  const handleDeleteBlock = (index: number) => {
    setBlocks(blocks.filter((_, i) => i !== index));
  };

  const handleMoveBlock = (index: number, direction: "up" | "down") => {
    if ((direction === "up" && index === 0) || (direction === "down" && index === blocks.length - 1)) return;
    const target = direction === "up" ? index - 1 : index + 1;
    const currentBlock = blocks[index];
    const targetBlock = blocks[target];
    if (!currentBlock || !targetBlock) return;
    const next = [...blocks];
    next[index] = targetBlock;
    next[target] = currentBlock;
    setBlocks(next);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">{policy.title}</h2>
            {policy.publishedVersion ? (
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                Published v{policy.publishedVersion.version}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                Draft (Not published to shoppers)
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {policy.publishedVersion
              ? `Live on storefront. Last published ${new Date(policy.publishedVersion.publishedAt).toLocaleDateString()}`
              : "Your storefront serves fallback generic text until you explicitly publish this policy."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewMode(!previewMode)}
          >
            <Eye className="mr-1.5 size-3.5" />
            {previewMode ? "Edit Blocks" : "Preview"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowVersions(!showVersions)}
          >
            <History className="mr-1.5 size-3.5" />
            Versions
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || saveDraftMutation.isPending}
            onClick={() =>
              saveDraftMutation.mutate({
                handle: policy.handle,
                title,
                content: { v: 1, blocks },
              })
            }
          >
            Save Draft
          </Button>

          <Button
            size="sm"
            disabled={publishMutation.isPending}
            onClick={() => setShowPublishDialog(true)}
          >
            Publish Policy
          </Button>
        </div>
      </div>

      {showVersions && (
        <SettingsSection
          title="Version history"
          description="Immutable snapshots created each time this policy was published. Restoring an earlier version copies its content into your current draft."
        >
          {versionsQuery.isLoading ? (
            <FormSkeleton />
          ) : !versionsQuery.data || versionsQuery.data.length === 0 ? (
            <p className="text-xs text-muted-foreground">No published versions yet.</p>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border">
              {versionsQuery.data.map((ver) => (
                <div key={ver.id} className="flex items-center justify-between p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-foreground">Version {ver.version}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{ver.contentSha256.slice(0, 12)}...</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Published {new Date(ver.publishedAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={restoreDraftMutation.isPending}
                    onClick={() =>
                      restoreDraftMutation.mutate({
                        handle: policy.handle,
                        versionId: ver.id,
                      })
                    }
                  >
                    <RotateCcw className="mr-1.5 size-3.5" />
                    Restore as Draft
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SettingsSection>
      )}

      {previewMode ? (
        <SettingsSection
          title="Storefront Shopper Preview"
          description="How this policy looks when rendered on your storefront."
        >
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
            <div className="mt-6 space-y-4 text-sm text-foreground">
              {blocks.map((block, i) => {
                if (block.type === "heading") {
                  return block.level === 3 ? (
                    <h3 key={i} className="text-base font-semibold text-foreground pt-2">{block.text}</h3>
                  ) : (
                    <h2 key={i} className="text-lg font-bold text-foreground pt-4">{block.text}</h2>
                  );
                }
                if (block.type === "paragraph") {
                  return <p key={i} className="leading-relaxed text-muted-foreground">{block.text}</p>;
                }
                if (block.type === "list") {
                  return block.style === "ordered" ? (
                    <ol key={i} className="list-decimal pl-5 space-y-1 text-muted-foreground">
                      {block.items.map((item: string, idx: number) => <li key={idx}>{item}</li>)}
                    </ol>
                  ) : (
                    <ul key={i} className="list-disc pl-5 space-y-1 text-muted-foreground">
                      {block.items.map((item: string, idx: number) => <li key={idx}>{item}</li>)}
                    </ul>
                  );
                }
                if (block.type === "divider") {
                  return <hr key={i} className="border-border my-4" />;
                }
                return null;
              })}
            </div>
          </div>
        </SettingsSection>
      ) : (
        <SettingsSection
          title="Block Editor"
          description="Add structured headings, paragraphs, lists, and dividers. Merchant text is strictly validated."
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Policy Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </div>

            <div className="space-y-3">
              {blocks.map((block, idx) => (
                <div key={idx} className="rounded-lg border border-border bg-card p-3 shadow-xs space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-semibold uppercase tracking-wider text-[10px] text-foreground">
                      {block.type}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={idx === 0}
                        onClick={() => handleMoveBlock(idx, "up")}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={idx === blocks.length - 1}
                        onClick={() => handleMoveBlock(idx, "down")}
                      >
                        ↓
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteBlock(idx)}
                      >
                        <Trash2 className="size-3 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {block.type === "heading" && (
                    <div className="flex gap-2">
                      <SimpleSelect
                        ariaLabel="Heading Level"
                        value={String(block.level)}
                        onChange={(v) => handleUpdateBlock(idx, { ...block, level: Number(v) as 2 | 3 })}
                        options={[
                          { value: "2", label: "Heading 2" },
                          { value: "3", label: "Heading 3" },
                        ]}
                      />
                      <Input
                        value={block.text}
                        onChange={(e) => handleUpdateBlock(idx, { ...block, text: e.target.value })}
                        placeholder="Heading text"
                      />
                    </div>
                  )}

                  {block.type === "paragraph" && (
                    <textarea
                      rows={3}
                      className="w-full rounded-md border border-input bg-background p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      value={block.text}
                      onChange={(e) => handleUpdateBlock(idx, { ...block, text: e.target.value })}
                      placeholder="Paragraph text..."
                    />
                  )}

                  {block.type === "list" && (
                    <div className="space-y-2">
                      <SimpleSelect
                        ariaLabel="List style"
                        value={block.style}
                        onChange={(v) => handleUpdateBlock(idx, { ...block, style: v as "ordered" | "unordered" })}
                        options={[
                          { value: "unordered", label: "Bullet list" },
                          { value: "ordered", label: "Numbered list" },
                        ]}
                      />
                      <textarea
                        rows={3}
                        className="w-full rounded-md border border-input bg-background p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        value={block.items.join("\n")}
                        onChange={(e) =>
                          handleUpdateBlock(idx, {
                            ...block,
                            items: e.target.value.split("\n"),
                          })
                        }
                        placeholder="One list item per line..."
                      />
                    </div>
                  )}

                  {block.type === "divider" && (
                    <div className="border-t border-border py-1 text-center text-[10px] text-muted-foreground">
                      Horizontal Rule
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => handleAddBlock("paragraph")}>
                <Plus className="mr-1 size-3" /> Paragraph
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleAddBlock("heading")}>
                <Plus className="mr-1 size-3" /> Heading
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleAddBlock("list")}>
                <Plus className="mr-1 size-3" /> List
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleAddBlock("divider")}>
                <Plus className="mr-1 size-3" /> Divider
              </Button>
            </div>
          </div>
        </SettingsSection>
      )}

      <ConfirmDialog
        open={showPublishDialog}
        onOpenChange={setShowPublishDialog}
        title="Publish Policy"
        description={
          <div>
            <p>
              Are you sure you want to publish this policy? This will snapshot the current draft as an immutable version and display it immediately to shoppers on your storefront.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Note: Policies with unreplaced placeholder markers (e.g. <code>[Store Name]</code>) or the starter draft advisory banner cannot be published.
            </p>
          </div>
        }
        confirmLabel="Publish Now"
        pending={publishMutation.isPending}
        onConfirm={() => publishMutation.mutate({ handle: policy.handle })}
      />
    </div>
  );
}
