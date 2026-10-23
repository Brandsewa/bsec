import { useState, type FormEvent } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Input,
  SimpleSelect,
  Switch,
  Textarea,
} from "@bs/ui";
import type { Category, CategoryDetail, CollectionRule, RichDescription } from "@bs/contracts";
import { RichDescriptionField } from "../rich-description-field.tsx";
import { SeoCard } from "../seo-card.tsx";
import { MediaField } from "../media/media-field.tsx";
import { CollectionTypeCard, NEW_RULE, ProductAssignmentsCard, ProductSortingCard, RulesBuilderCard } from "../collection/collection-parts.tsx";
import type { PickedProduct } from "../product/product-picker-dialog.tsx";

export interface CategoryFormValues {
  name: string;
  slug: string;
  description: string;
  descriptionJson: RichDescription | null;
  parentId: string | null;
  isActive: boolean;
  isFeatured: boolean;
  position: number;
  imageMediaId: string | null;
  type: "manual" | "automated";
  match: "all" | "any";
  rules: CollectionRule[];
  sortOrder: string;
  /** Manual categories: the assigned products, in order. */
  productIds: string[];
  seoTitle: string;
  seoDescription: string;
}

const slugify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/**
 * The category form, identical for adding and editing (same two-column layout as the product page):
 * General Information and Search engine listing on the left; Hierarchy, Visibility & Merchandising and the image on the right.
 * The page supplies the header buttons, which submit this form through `formId`.
 */
export function CategoryForm({
  formId,
  category,
  categories,
  onSubmit,
}: {
  formId: string;
  /** The category being edited; omitted when adding. */
  category?: CategoryDetail;
  categories: Category[];
  onSubmit: (values: CategoryFormValues) => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [descriptionJson, setDescriptionJson] = useState<RichDescription | null>(category?.descriptionJson ?? null);
  const [parentId, setParentId] = useState<string>(category?.parentId ?? "none");
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [isFeatured, setIsFeatured] = useState(category?.isFeatured ?? false);
  const [displayOrder, setDisplayOrder] = useState(String(category?.position ?? 0));
  const [imageMediaId, setImageMediaId] = useState<string | null>(category?.imageMediaId ?? null);
  const [seoTitle, setSeoTitle] = useState(category?.seo?.title ?? "");
  const [seoDescription, setSeoDescription] = useState(category?.seo?.description ?? "");
  const [type, setType] = useState<"manual" | "automated">(category?.type ?? "manual");
  const [match, setMatch] = useState<"all" | "any">(category?.match ?? "all");
  const [rules, setRules] = useState<CollectionRule[]>(category?.rules && category.rules.length > 0 ? category.rules : [{ ...NEW_RULE }]);
  const [sortOrder, setSortOrder] = useState(category?.sortOrder ?? "manual");
  const [products, setProducts] = useState<PickedProduct[]>(() => {
    const byId = new Map((category?.products ?? []).map((p) => [p.id, p]));
    return (category?.productIds ?? []).map((id) => byId.get(id) ?? { id, title: "Unknown product" });
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Eligible parents: not itself or one of its own descendants, and shallow enough to keep the tree within 3 levels.
  const parentOptions = [
    { value: "none", label: "None (Top-level parent category)" },
    ...categories
      .filter((c) => {
        if (category && (c.id === category.id || c.path?.includes(`/${category.id}/`))) return false;
        return ((c.path ?? "/").match(/\//g) || []).length < 3;
      })
      .map((c) => ({ value: c.id, label: `${(c.path ?? "/").replace(/^\/|\/$/g, "") ? "— " : ""}${c.name}` })),
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next["name"] = "Category name is required";
    if (slug.trim() && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) next["slug"] = "Use lowercase letters, numbers, and hyphens only";
    if (description.length > 500) next["description"] = "Description cannot exceed 500 characters";
    const order = parseInt(displayOrder, 10);
    if (Number.isNaN(order) || order < 0) next["displayOrder"] = "Must be a non-negative integer";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSubmit({
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim(),
      descriptionJson,
      parentId: parentId === "none" ? null : parentId,
      isActive,
      isFeatured,
      position: order,
      imageMediaId,
      type,
      match,
      rules,
      sortOrder,
      productIds: products.map((p) => p.id),
      seoTitle: seoTitle.trim(),
      seoDescription: seoDescription.trim(),
    });
  }

  const err = (k: string) =>
    errors[k] ? (
      <p role="alert" className="text-xs text-destructive">
        {errors[k]}
      </p>
    ) : null;

  return (
    <form id={formId} onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-3" noValidate>
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">General Information</CardTitle>
            <CardDescription>Name, handle and description for the category.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="cat-name">Name *</FieldLabel>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  // New categories keep the handle in step with the name until it is edited by hand.
                  if (!category && (!slug || slug === slugify(name))) setSlug(slugify(e.target.value));
                }}
                placeholder="e.g. Mechanical Keyboards"
                aria-invalid={Boolean(errors["name"])}
              />
              {err("name")}
            </div>

            <div className="grid gap-1.5">
              <FieldLabel htmlFor="cat-slug">URL Handle (Slug)</FieldLabel>
              <Input
                id="cat-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g. mechanical-keyboards"
                aria-invalid={Boolean(errors["slug"])}
              />
              {err("slug")}
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="cat-desc">Short description</FieldLabel>
                <span className={`text-xs ${description.length > 500 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{description.length} / 500</span>
              </div>
              <Textarea
                id="cat-desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief category overview for the storefront..."
                maxLength={500}
              />
              {err("description")}
            </div>

            <RichDescriptionField id="cat-long-description" value={descriptionJson} onChange={setDescriptionJson} tip="Shown below the products on the category page, for detail content such as buying guides or care notes. Supports headings, bold, italic, links, lists and dividers." />
          </CardContent>
        </Card>

        <CollectionTypeCard
          value={type}
          onChange={setType}
          noun="category"
          idPrefix="cat"
          manualHelp="Choose the products in this category one by one and put them in your own order."
          automatedHelp="Existing and future products matching your conditions are included automatically."
        />

        {type === "manual" ? (
          <ProductAssignmentsCard products={products} onChange={setProducts} description="Pick the products in this category, then arrange their order." />
        ) : (
          <RulesBuilderCard rules={rules} onRulesChange={setRules} match={match} onMatchChange={setMatch} idPrefix="cat" />
        )}

        <SeoCard
          defaultTitle={name}
          defaultDescription={description}
          pathPrefix="/categories"
          slug={slug}
          onSlugChange={setSlug}
          title={seoTitle}
          onTitleChange={setSeoTitle}
          description={seoDescription}
          onDescriptionChange={setSeoDescription}
        />
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Visibility & Merchandising</CardTitle>
            <CardDescription>Control category visibility across your storefront.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field orientation="horizontal" className="justify-between">
              <div>
                <FieldLabel htmlFor="cat-active" className="cursor-pointer text-sm font-medium">
                  Active
                </FieldLabel>
                <p className="text-xs text-muted-foreground">Inactive categories are hidden from storefront menus and category lists.</p>
              </div>
              <Switch id="cat-active" checked={isActive} onCheckedChange={(c) => setIsActive(Boolean(c))} />
            </Field>
            <Field orientation="horizontal" className="justify-between border-t border-border pt-3">
              <div>
                <FieldLabel htmlFor="cat-featured" className="cursor-pointer text-sm font-medium">
                  Featured category
                </FieldLabel>
                <p className="text-xs text-muted-foreground">Highlight this category in featured category blocks on your homepage.</p>
              </div>
              <Switch id="cat-featured" checked={isFeatured} onCheckedChange={(c) => setIsFeatured(Boolean(c))} />
            </Field>
          </CardContent>
        </Card>

        <ProductSortingCard value={sortOrder} onChange={setSortOrder} noun="category" />

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Hierarchy</CardTitle>
            <CardDescription>Position within the 3-level category tree.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="parent-category">Parent category</FieldLabel>
              <SimpleSelect id="parent-category" value={parentId} onChange={setParentId} options={parentOptions} />
              <p className="text-xs text-muted-foreground">Categories can be nested up to 3 levels deep.</p>
            </div>
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="cat-position">Display order position</FieldLabel>
              <Input id="cat-position" type="number" min="0" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} className="max-w-[120px]" />
              <p className="text-xs text-muted-foreground">Lower numbers appear first within the same parent level.</p>
              {err("displayOrder")}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Category Image</CardTitle>
            <CardDescription>Shown in collection grids, category lists and menus.</CardDescription>
          </CardHeader>
          <CardContent>
            <MediaField value={imageMediaId} onChange={setImageMediaId} accept={["image"]} aspect="16:9" />
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
