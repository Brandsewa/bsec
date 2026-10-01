import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Laptop, LayoutTemplate, Palette, RotateCcw, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BlocksPreview, useFontLink } from "@bs/block-editor/preview";
import { THEME_PAGE_LABELS, THEME_SYSTEM_PAGES, computeThemeTokens, googleFontsHref, type BlockInstance } from "@bs/blocks";
import type { ThemeLibraryItem } from "@bs/contracts";
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
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSkeleton,
  toast,
} from "@bs/ui";
import { orpc } from "../../../lib/orpc.ts";
import { storeHost } from "../../../components/page-editor/host.ts";

export const Route = createFileRoute("/_store/online-store/theme-library")({
  pendingComponent: () => <PageSkeleton />,
  component: ThemeLibraryPage,
});

export function ThemeLibraryPage() {
  const navigate = useNavigate();
  const { store } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const libraryQuery = useQuery(orpc.admin.themes.library.queryOptions());
  const pagesQuery = useQuery(orpc.admin.pages.list.queryOptions());
  const [previewing, setPreviewing] = useState<ThemeLibraryItem | null>(null);
  const [activating, setActivating] = useState<ThemeLibraryItem | null>(null);

  const activate = useMutation(
    orpc.admin.themes.activate.mutationOptions({
      onSuccess: async (res) => {
        toast.success(`"${res.name}" is now your theme. Your previous homepage is saved in the page history.`);
        setActivating(null);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.admin.themes.library.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.admin.themes.get.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.admin.pages.list.key() }),
        ]);
      },
      onError: (err: Error) => toast.error(`Could not activate theme: ${err.message}`),
    }),
  );

  const homePage = pagesQuery.data?.find((p) => p.type === "home" || p.slug === "home");
  const current = libraryQuery.data?.find((t) => t.isCurrent);
  const openPage = (pageId: string) => void navigate({ to: "/online-store/editor/$pageId", params: { pageId } });
  const customise = () => {
    if (homePage) openPage(homePage.id);
  };
  // The store's own copies of the theme's pages. A page the theme does not define is simply absent.
  const themePages = (["home", "collection", "product", "header", "footer"] as const).map((key) => {
    const page =
      key === "home"
        ? homePage
        : pagesQuery.data?.find((p) => p.type === THEME_SYSTEM_PAGES[key].type && p.publishedVersionId);
    return { key, label: THEME_PAGE_LABELS[key], page };
  });

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Online Store", href: "/online-store/theme-library" }, { label: "Themes" }]}
        actions={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void navigate({ to: "/online-store/theme" })}>
              <Palette className="mr-1.5 size-3.5" aria-hidden />
              Brand and logo
            </Button>
            {current ? (
              <Button size="sm" variant="primary" onClick={() => void navigate({ to: "/online-store/theme-settings" })}>
                Theme settings
              </Button>
            ) : null}
          </div>
        }
      />
      <PageHeader
        title="Themes"
        description="Pick a theme, then customise every section of your storefront with the visual editor. Your changes stay in a draft until you publish."
      />

      {current ? (
        <section aria-label="Customise your theme" className="mb-6 rounded-lg border border-border bg-surface-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Customise {current.name}</h2>
              <p className="text-sm text-foreground-light">
                Change colours, fonts and buttons in theme settings, then edit the layout of each page. Changes to pages stay in a draft until you publish; theme settings apply when you save.
              </p>
            </div>
            <Button size="sm" onClick={() => void navigate({ to: "/online-store/theme-settings" })}>
              <Palette className="mr-1.5 size-3.5" aria-hidden />
              Theme settings
            </Button>
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {themePages.map(({ key, label, page }) => (
              <li key={key}>
                <button
                  type="button"
                  disabled={!page}
                  onClick={() => page && openPage(page.id)}
                  className="flex w-full flex-col items-start gap-1 rounded-md border border-border bg-background p-3 text-left text-sm transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <LayoutTemplate className="size-4 text-foreground-lighter" aria-hidden />
                  <span className="font-medium text-foreground">{label}</span>
                  <span className="text-xs text-foreground-lighter">{page ? "Open in editor" : "Built-in layout"}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {libraryQuery.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-foreground">Could not load themes</p>
          <p className="text-sm text-foreground-light">{libraryQuery.error.message}</p>
          <Button size="sm" onClick={() => void libraryQuery.refetch()}>
            <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
            Retry
          </Button>
        </div>
      ) : !libraryQuery.data ? (
        <PageSkeleton />
      ) : libraryQuery.data.length === 0 ? (
        <EmptyState icon={Palette} title="No themes available yet" description="The platform has not published a theme yet. Check back soon." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {libraryQuery.data.map((t) => (
            <article key={t.code} className={`flex flex-col rounded-lg border bg-surface-50 ${t.isCurrent ? "border-primary" : "border-border"}`}>
              <div className="flex aspect-[16/9] items-center justify-center rounded-t-lg bg-surface-100 text-foreground-lighter">
                <Palette className="size-10" aria-hidden />
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-foreground">{t.name}</h2>
                    {t.isCurrent ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                        <CheckCircle2 className="size-3" aria-hidden /> Current theme
                      </span>
                    ) : null}
                    {t.updateAvailable ? (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600">Newer version available</span>
                    ) : null}
                  </div>
                  {t.description ? <p className="mt-1 text-sm text-foreground-light">{t.description}</p> : null}
                </div>
                {t.features.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {t.features.map((f) => (
                      <li key={f} className="rounded bg-surface-200 px-1.5 py-0.5 text-[11px] text-foreground-light">
                        {f}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {t.updateAvailable ? (
                  <p className="text-xs text-foreground-lighter">Nothing changes until you apply it. Applying replaces your theme settings and page layouts with the new version; each page's previous layout stays in its history so you can roll back.</p>
                ) : null}
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <Button size="sm" onClick={() => setPreviewing(t)}>
                    Preview
                  </Button>
                  {t.isCurrent ? (
                    <Button size="sm" variant="primary" disabled={!homePage} onClick={customise}>
                      Customise
                    </Button>
                  ) : null}
                  {!t.isCurrent || t.updateAvailable ? (
                    <Button size="sm" variant={t.isCurrent ? "default" : "primary"} onClick={() => setActivating(t)}>
                      {t.isCurrent ? "Apply update" : "Activate"}
                    </Button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <ThemePreviewDialog storeName={store?.name} theme={previewing} onClose={() => setPreviewing(null)} onActivate={(t) => { setPreviewing(null); setActivating(t); }} />

      <Dialog open={!!activating} onOpenChange={(open) => !open && setActivating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{activating?.isCurrent ? "Apply theme update?" : `Activate "${activating?.name}"?`}</DialogTitle>
            <DialogDescription>
              Your colours, fonts, buttons, header, footer and the home, collection and product pages will use this theme. Your current homepage is not deleted: it stays in the page history and you can roll back to it from the Pages screen. Your products, orders and settings are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button variant="primary" loading={activate.isPending} onClick={() => activating && activate.mutate({ code: activating.code })}>
              {activating?.isCurrent ? "Apply update" : "Activate theme"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

const PREVIEW_PAGES = ["home", "collection", "product"] as const;

function ThemePreviewDialog({
  theme,
  storeName,
  onClose,
  onActivate,
}: {
  theme: ThemeLibraryItem | null;
  storeName?: string | undefined;
  onClose: () => void;
  onActivate: (t: ThemeLibraryItem) => void;
}) {
  const [mobile, setMobile] = useState(false);
  const [pageKey, setPageKey] = useState<(typeof PREVIEW_PAGES)[number]>("home");
  const previewQuery = useQuery({
    ...orpc.admin.themes.preview.queryOptions({ input: { code: theme?.code ?? "" } }),
    enabled: !!theme,
  });
  // The preview uses the theme's own colours, fonts and buttons: that is what activating it gives you.
  const vars = useMemo(() => computeThemeTokens(null, (previewQuery.data?.tokens ?? null) as never), [previewQuery.data]);
  useFontLink(googleFontsHref((previewQuery.data?.tokens ?? null) as never));
  const pages = (previewQuery.data?.pages ?? {}) as Record<string, BlockInstance[]>;
  const available = PREVIEW_PAGES.filter((k) => (pages[k]?.length ?? 0) > 0);
  const shown = available.includes(pageKey) ? pageKey : "home";
  const blocks = [...(pages["header"] ?? []), ...(pages[shown] ?? []), ...(pages["footer"] ?? [])];

  return (
    <Dialog open={!!theme} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{theme?.name} preview</DialogTitle>
          <DialogDescription>Shown with your store&apos;s own products. Nothing changes until you activate it.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {available.map((k) => (
            <Button key={k} size="sm" variant={shown === k ? "primary" : "default"} onClick={() => setPageKey(k)}>
              {THEME_PAGE_LABELS[k]}
            </Button>
          ))}
          <span className="mx-1 w-px bg-border" aria-hidden />
          <Button size="sm" variant={mobile ? "default" : "primary"} onClick={() => setMobile(false)}>
            <Laptop className="mr-1.5 size-3.5" aria-hidden /> Desktop
          </Button>
          <Button size="sm" variant={mobile ? "primary" : "default"} onClick={() => setMobile(true)}>
            <Smartphone className="mr-1.5 size-3.5" aria-hidden /> Mobile
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-background">
          {previewQuery.isError ? (
            <p role="alert" className="p-4 text-sm text-foreground-light">Could not load the preview: {previewQuery.error.message}</p>
          ) : !previewQuery.data ? (
            <PageSkeleton />
          ) : (
            <BlocksPreview blocks={blocks} host={storeHost} themeVars={vars} storeName={storeName} width={mobile ? 375 : undefined} />
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Close</Button>
          </DialogClose>
          {theme && (!theme.isCurrent || theme.updateAvailable) ? (
            <Button variant="primary" onClick={() => onActivate(theme)}>
              {theme.isCurrent ? "Apply update" : "Activate"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
