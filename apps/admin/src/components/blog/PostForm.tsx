import { lazy, Suspense, useMemo, useState } from "react";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, Globe, Save, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DateTimePicker,
  FieldLabel,
  InfoTip,
  Input,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  RadioGroup,
  RadioGroupItem,
  SimpleSelect,
  Switch,
  Textarea,
  toast,
} from "@bs/ui";
import type { BlogPostDetail } from "@bs/contracts";
import { MediaField } from "../media/media-field.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

// The editor (Tiptap) is only downloaded on this screen.
const BlogEditor = lazy(() => import("./BlogEditor.tsx"));

type Visibility = "draft" | "published" | "scheduled";

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80)
    .replace(/-$/, "");
}

function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

interface FormState {
  title: string;
  slug: string;
  slugTouched: boolean;
  excerpt: string;
  html: string;
  categoryId: string;
  featuredId: string | null;
  featuredAlt: string;
  author: string;
  isFeatured: boolean;
  seoTitle: string;
  seoDescription: string;
  seoImageId: string | null;
  noindex: boolean;
  visibility: Visibility;
  scheduledAt: Date | undefined;
}

function initialState(p: BlogPostDetail | null): FormState {
  return {
    title: p?.title ?? "",
    slug: p?.slug ?? "",
    slugTouched: Boolean(p),
    excerpt: p?.excerpt ?? "",
    html: p?.contentHtml ?? "",
    categoryId: p?.categoryId ?? "",
    featuredId: p?.featuredImageMediaId ?? null,
    featuredAlt: p?.featuredImageAlt ?? "",
    author: p?.authorName ?? "",
    isFeatured: p?.isFeatured ?? false,
    seoTitle: p?.seo?.title ?? "",
    seoDescription: p?.seo?.description ?? "",
    seoImageId: p?.seo?.imageMediaId ?? null,
    noindex: p?.seo?.noindex ?? false,
    visibility: p?.status ?? "draft",
    scheduledAt: p?.status === "scheduled" && p.publishedAt ? new Date(p.publishedAt) : undefined,
  };
}

/** Create or edit a blog post. The edit screen mounts this only after the post has loaded. */
export function PostForm({ postId }: { postId?: string | undefined }) {
  const query = useQuery({ ...orpc.admin.blog.posts.get.queryOptions({ input: { id: postId ?? "" } }), enabled: Boolean(postId) });
  if (postId && query.isLoading) return <PageContainer size="full"><div className="h-96 animate-pulse rounded-xl bg-muted/40" aria-busy /></PageContainer>;
  if (postId && !query.data) {
    return (
      <PageContainer size="full">
        <PageHeader title="Post not found" description="It may have been deleted." />
      </PageContainer>
    );
  }
  return <PostFormInner key={postId ?? "new"} post={query.data ?? null} />;
}

function PostFormInner({ post }: { post: BlogPostDetail | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const initial = useMemo(() => initialState(post), [post]);
  const [s, setS] = useState<FormState>(initial);
  const [saved, setSaved] = useState<FormState>(initial);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const patch = (p: Partial<FormState>) => setS((prev) => ({ ...prev, ...p }));

  const categories = useQuery(orpc.admin.blog.categories.list.queryOptions());
  const categoryOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: "", label: "No category" }];
    for (const c of categories.data ?? []) {
      opts.push({ value: c.id, label: c.name });
      for (const k of c.children ?? []) opts.push({ value: k.id, label: `${c.name} › ${k.name}` });
    }
    return opts;
  }, [categories.data]);

  // The editor re-serialises the stored HTML on load (it drops the heading ids the server adds), so compare without them.
  const comparable = (f: FormState) => JSON.stringify({ ...f, html: f.html.replace(/ id="[^"]*"/g, "").replace(/<p><\/p>/g, ""), scheduledAt: f.scheduledAt?.getTime() });
  const dirty = comparable(s) !== comparable(saved);
  const blocker = useBlocker({ shouldBlockFn: () => dirty, enableBeforeUnload: () => dirty, withResolver: true });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.blog.posts.list.key() });

  const buildInput = () => ({
    title: s.title.trim(),
    slug: s.slug.trim() || undefined,
    excerpt: s.excerpt.trim() || null,
    contentHtml: s.html,
    featuredImageMediaId: s.featuredId,
    featuredImageAlt: s.featuredAlt.trim() || null,
    categoryId: s.categoryId || null,
    authorName: s.author.trim() || undefined,
    isFeatured: s.isFeatured,
    seo: {
      title: s.seoTitle.trim() || null,
      description: s.seoDescription.trim() || null,
      imageMediaId: s.seoImageId,
      noindex: s.noindex,
    },
    status: s.visibility,
    ...(s.visibility === "scheduled" && s.scheduledAt ? { publishedAt: s.scheduledAt.toISOString() } : {}),
  });

  const createMutation = useMutation(
    orpc.admin.blog.posts.create.mutationOptions({
      onSuccess: (res) => {
        toast.success(s.visibility === "published" ? "Post published" : "Post saved");
        setSaved(s);
        invalidate();
        // Leave on the next tick so the blocker sees a clean form.
        setTimeout(() => void navigate({ to: "/online-store/blog/$id", params: { id: res.id } }), 0);
      },
      onError: (err) => toast.error(errorMessage(err, "Could not save the post")),
    }),
  );
  const updateMutation = useMutation(
    orpc.admin.blog.posts.update.mutationOptions({
      onSuccess: (res) => {
        toast.success("Post saved");
        setSaved({ ...s, slug: res.slug, visibility: res.status });
        setS((prev) => ({ ...prev, slug: res.slug, visibility: res.status }));
        invalidate();
        if (post) void queryClient.invalidateQueries({ queryKey: orpc.admin.blog.posts.get.key({ input: { id: post.id } }) });
      },
      onError: (err) => toast.error(errorMessage(err, "Could not save the post")),
    }),
  );
  const deleteMutation = useMutation(
    orpc.admin.blog.posts.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Post deleted");
        setSaved(s);
        invalidate();
        setTimeout(() => void navigate({ to: "/online-store/blog" }), 0);
      },
      onError: (err) => toast.error(errorMessage(err, "Could not delete the post")),
    }),
  );
  const saving = createMutation.isPending || updateMutation.isPending;

  const save = () => {
    if (!s.title.trim()) {
      toast.error("Add a title first");
      return;
    }
    if (s.visibility === "scheduled" && !s.scheduledAt) {
      toast.error("Pick a date and time to schedule the post");
      return;
    }
    const input = buildInput();
    if (post) updateMutation.mutate({ id: post.id, ...input });
    else createMutation.mutate(input);
  };

  const effectiveTitle = s.seoTitle.trim() || s.title.trim();
  const effectiveDescription = s.seoDescription.trim() || s.excerpt.trim() || plainText(s.html).slice(0, 155);
  const words = plainText(s.html) ? plainText(s.html).split(" ").length : 0;
  const checks = [
    { ok: effectiveTitle.length >= 30 && effectiveTitle.length <= 60, text: `Search title is ${effectiveTitle.length} characters (aim for 30 to 60)` },
    { ok: effectiveDescription.length >= 120 && effectiveDescription.length <= 160, text: `Description is ${effectiveDescription.length} characters (aim for 120 to 160)` },
    { ok: s.slug.length > 0 && s.slug.length <= 75, text: s.slug ? `Address is ${s.slug.length} characters` : "The address is created from the title when you save" },
    { ok: Boolean(s.featuredId) && Boolean(s.featuredAlt.trim()), text: s.featuredId ? (s.featuredAlt.trim() ? "Featured image has alt text" : "Add alt text to the featured image") : "Add a featured image" },
    { ok: !/<h1[\s>]/i.test(s.html), text: "Only one top heading (the title); use H2 to H4 in the text" },
    { ok: /href="\//.test(s.html), text: "Link to one of your own pages or products" },
    { ok: words >= 300, text: `${words} words (300 or more reads as a full article)` },
  ];

  const dateLabel = post?.publishedAt && post.status !== "draft" ? new Date(post.publishedAt).toLocaleString() : null;

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Blog", href: "/online-store/blog" }, { label: post ? post.title : "New post" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/online-store/blog" })}>
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Posts
            </Button>
            {post && (
              <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} disabled={deleteMutation.isPending}>
                <Trash2 className="mr-1.5 size-3.5" aria-hidden />
                Delete
              </Button>
            )}
            <Button type="button" size="sm" onClick={save} disabled={saving || (post !== null && !dirty)}>
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {saving ? "Saving..." : s.visibility === "published" && post?.status !== "published" ? "Save and publish" : "Save"}
            </Button>
          </div>
        }
      />
      <PageHeader title={post ? post.title : "New post"} description="Write the post, choose its category and image, and set how it appears in search results." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardContent className="grid gap-4 pt-5">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="post-title">Title *</FieldLabel>
                <Input
                  id="post-title"
                  value={s.title}
                  onChange={(e) => patch({ title: e.target.value, ...(s.slugTouched ? {} : { slug: slugify(e.target.value) }) })}
                  placeholder="e.g. How to choose your first trekking boots"
                />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center gap-1.5">
                  <FieldLabel htmlFor="post-slug">Address</FieldLabel>
                  <InfoTip>The web address of the post. If you change it after publishing, the old address keeps working and sends visitors to the new one.</InfoTip>
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-sm text-muted-foreground">/blog/</span>
                  <Input id="post-slug" value={s.slug} onChange={(e) => patch({ slug: slugify(e.target.value), slugTouched: true })} className="font-mono text-sm" />
                </div>
              </div>
              <div className="grid gap-1.5">
                <FieldLabel>Content</FieldLabel>
                <Suspense fallback={<div className="min-h-[360px] animate-pulse rounded-lg bg-muted/40" aria-hidden />}>
                  <BlogEditor initialHtml={initial.html} resetKey={post?.id ?? "new"} onChange={(html) => patch({ html })} />
                </Suspense>
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <FieldLabel htmlFor="post-excerpt">Excerpt</FieldLabel>
                    <InfoTip>A short summary shown on the blog list and in the recent posts section. Plain text only.</InfoTip>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">{s.excerpt.length}/300</span>
                </div>
                <Textarea id="post-excerpt" value={s.excerpt} maxLength={300} rows={3} onChange={(e) => patch({ excerpt: e.target.value })} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Globe className="size-4 text-muted-foreground" aria-hidden />
                Search engine listing
              </CardTitle>
              <CardDescription>How this post appears in Google and when it is shared.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="rounded-lg bg-muted/40 p-4">
                <div className="truncate text-xs text-muted-foreground">your-store.com/blog/{s.slug || "address"}</div>
                <div className="mt-1 line-clamp-1 text-base font-medium text-blue-600 dark:text-blue-400">{effectiveTitle || "Post title"}</div>
                <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{effectiveDescription || "The description appears here."}</div>
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="seo-title">Search title</FieldLabel>
                  <span className="text-xs tabular-nums text-muted-foreground">{s.seoTitle.length}/120</span>
                </div>
                <Input id="seo-title" value={s.seoTitle} maxLength={120} onChange={(e) => patch({ seoTitle: e.target.value })} placeholder={s.title || "Uses the post title"} />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="seo-description">Meta description</FieldLabel>
                  <span className="text-xs tabular-nums text-muted-foreground">{s.seoDescription.length}/320</span>
                </div>
                <Textarea id="seo-description" rows={3} value={s.seoDescription} maxLength={320} onChange={(e) => patch({ seoDescription: e.target.value })} placeholder="Uses the excerpt when empty" />
              </div>
              <MediaField
                label="Social sharing image"
                description="Shown when the post is shared. Uses the featured image when empty."
                value={s.seoImageId}
                onChange={(id) => patch({ seoImageId: id })}
              />
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5">
                  <FieldLabel htmlFor="seo-noindex">Hide from search engines</FieldLabel>
                  <InfoTip>The post stays visible to anyone with the link but search engines are asked not to list it, and it is left out of the sitemap.</InfoTip>
                </div>
                <Switch id="seo-noindex" checked={s.noindex} onCheckedChange={(v) => patch({ noindex: v })} />
              </div>
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  SEO checklist
                  <InfoTip>Advice only. None of these stop you from saving or publishing.</InfoTip>
                </div>
                <ul className="grid gap-1.5 text-sm">
                  {checks.map((c) => (
                    <li key={c.text} className="flex items-start gap-2">
                      {c.ok ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />}
                      <span className={c.ok ? "text-muted-foreground" : "text-foreground"}>{c.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base font-semibold">
                Visibility
                {post && <Badge variant="outline">{post.status === "published" ? "Published" : post.status === "scheduled" ? "Scheduled" : "Draft"}</Badge>}
              </CardTitle>
              {dateLabel && <CardDescription>Publish date: {dateLabel}</CardDescription>}
            </CardHeader>
            <CardContent className="grid gap-3">
              <RadioGroup value={s.visibility} onValueChange={(v) => patch({ visibility: v as Visibility })} className="grid gap-2">
                {(
                  [
                    ["draft", "Draft", "Only you and your team can see it."],
                    ["published", "Published", "Visible to everyone now."],
                    ["scheduled", "Scheduled", "Goes live at the date and time you pick."],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label key={value} className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 hover:bg-muted/50">
                    <RadioGroupItem value={value} className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              {s.visibility === "scheduled" && <DateTimePicker value={s.scheduledAt} onChange={(d) => patch({ scheduledAt: d })} placeholder="Pick publish date and time" />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Organise</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <FieldLabel>Category</FieldLabel>
                <SimpleSelect value={s.categoryId} onChange={(v) => patch({ categoryId: v })} ariaLabel="Category" options={categoryOptions} placeholder="No category" />
              </div>
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="post-author">Author</FieldLabel>
                <Input id="post-author" value={s.author} onChange={(e) => patch({ author: e.target.value })} placeholder="Defaults to your name" />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5">
                  <FieldLabel htmlFor="post-featured">Featured post</FieldLabel>
                  <InfoTip>Featured posts can be picked out in the recent posts section.</InfoTip>
                </div>
                <Switch id="post-featured" checked={s.isFeatured} onCheckedChange={(v) => patch({ isFeatured: v })} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Featured image</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <MediaField value={s.featuredId} onChange={(id) => patch({ featuredId: id })} aspect="16/9" />
              <div className="grid gap-1.5">
                <FieldLabel htmlFor="post-alt">Alt text</FieldLabel>
                <Input id="post-alt" value={s.featuredAlt} maxLength={300} onChange={(e) => patch({ featuredAlt: e.target.value })} placeholder="Describe the picture for screen readers" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this post?"
        description={<p>This permanently deletes <strong>{post?.title}</strong>. Its address will no longer work.</p>}
        confirmLabel="Delete post"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => post && deleteMutation.mutate({ id: post.id })}
      />
      <ConfirmDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title="Discard unsaved changes?"
        description="You have unsaved changes to this post that will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => blocker.proceed?.()}
      />
    </PageContainer>
  );
}
