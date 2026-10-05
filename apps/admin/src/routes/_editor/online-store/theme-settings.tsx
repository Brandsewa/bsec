import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ThemeSettingsEditor, type ThemeTokens } from "@bs/block-editor/preview";
import { THEME_SYSTEM_PAGES, type BlockInstance } from "@bs/blocks";
import { Button, ConfirmDialog, EmptyState, PageContainer, PageSkeleton, toast } from "@bs/ui";
import { orpc } from "../../../lib/orpc.ts";
import { storeHost } from "../../../components/page-editor/host.ts";

export const Route = createFileRoute("/_editor/online-store/theme-settings")({
  pendingComponent: () => <PageSkeleton />,
  component: ThemeSettingsRoute,
});

function ThemeSettingsRoute() {
  const { store } = Route.useRouteContext();
  const canPublish = store?.permissions.includes("theme.publish") ?? false;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const themeQuery = useQuery(orpc.admin.themes.get.queryOptions());
  const pagesQuery = useQuery(orpc.admin.pages.list.queryOptions());
  const back = () => void navigate({ to: "/online-store/theme-library" });

  // The preview shows the store's own header, home page and footer (their latest drafts).
  const ids = useMemo(() => {
    const list = pagesQuery.data ?? [];
    const find = (pred: (p: (typeof list)[number]) => boolean) => list.find(pred)?.id;
    return [
      find((p) => p.type === THEME_SYSTEM_PAGES.header.type),
      find((p) => p.type === "home" || p.slug === "home"),
      find((p) => p.type === THEME_SYSTEM_PAGES.footer.type),
    ];
  }, [pagesQuery.data]);
  const pageQueries = useQueries({
    queries: ids.map((id) => ({
      ...orpc.admin.pages.get.queryOptions({ input: { id: id ?? "", draft: true } }),
      enabled: !!id,
    })),
  });

  if (themeQuery.isError) {
    return (
      <PageContainer size="small">
        <EmptyState title="Could not load theme settings" description={themeQuery.error.message} action={<Button onClick={back}>Back to themes</Button>} />
      </PageContainer>
    );
  }
  if (!themeQuery.data || pagesQuery.isPending) return <PageSkeleton />;
  const previewBlocks = pageQueries.flatMap((q) => (q.data?.blocks ?? []) as BlockInstance[]);

  return (
    <Screen
      key={themeQuery.data.id}
      initial={themeQuery.data.tokens as ThemeTokens}
      themeName={themeQuery.data.name}
      storeName={store?.name}
      canPublish={canPublish}
      previewBlocks={previewBlocks}
      onBack={back}
      onSaved={() =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.admin.themes.get.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.admin.themes.library.key() }),
        ]).then(() => undefined)
      }
    />
  );
}

function Screen({
  initial,
  themeName,
  storeName,
  canPublish,
  previewBlocks,
  onBack,
  onSaved,
}: {
  initial: ThemeTokens;
  themeName: string;
  storeName?: string | undefined;
  canPublish: boolean;
  previewBlocks: BlockInstance[];
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const [tokens, setTokens] = useState<ThemeTokens>(initial);
  const [dirty, setDirty] = useState(false);
  const save = useMutation(
    orpc.admin.themes.update.mutationOptions({
      onSuccess: async () => {
        setDirty(false);
        await onSaved();
        toast.success("Theme settings saved and live on your store.");
      },
      onError: (e: Error) => toast.error(`Could not save: ${e.message}`),
    }),
  );

  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-[var(--background)]">
      <div className="flex items-center gap-3 px-4 h-[52px] border-b border-[var(--border)] bg-[var(--card)] shrink-0">
        <Button size="sm" onClick={() => (dirty ? setConfirmLeaveOpen(true) : onBack())}>
          ← Themes
        </Button>
        <strong className="text-sm font-semibold">Theme settings · {themeName}</strong>
        <span className={dirty ? "ml-auto text-xs text-[var(--warning)]" : "ml-auto text-xs text-[var(--muted-foreground)]"}>
          {dirty ? "Unsaved changes" : canPublish ? "Saved settings are live on your store" : "You can view but not change theme settings"}
        </span>
        <Button size="sm" variant="primary" disabled={!dirty || !canPublish} loading={save.isPending} onClick={() => save.mutate({ tokens })}>
          Save and apply
        </Button>
      </div>
      <ConfirmDialog
        open={confirmLeaveOpen}
        onOpenChange={setConfirmLeaveOpen}
        title="Discard unsaved changes?"
        description="You have unsaved changes in theme settings. Are you sure you want to leave without saving?"
        confirmLabel="Leave without saving"
        destructive
        onConfirm={async () => {
          setConfirmLeaveOpen(false);
          onBack();
        }}
      />
      <div className="flex-1 min-h-0">
        <ThemeSettingsEditor
          tokens={tokens}
          onChange={(t) => {
            setTokens(t);
            setDirty(true);
          }}
          previewBlocks={previewBlocks}
          host={storeHost}
          storeName={storeName}
          disabled={!canPublish}
        />
      </div>
    </div>
  );
}
