import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Eye, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { DetailSkeleton, EmptyState, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category, CategoryDetail } from "@bs/contracts";
import { Button } from "@bs/ui";
import { ConfirmDialog } from "@bs/ui";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";
import { CategoryForm } from "../../components/category/category-form.tsx";
import { storefrontLink, useStorefrontUrl } from "../../lib/storefront-url.ts";

export const Route = createFileRoute("/_store/categories_/$id")({
  pendingComponent: () => (
    <PageSkeleton>
      <DetailSkeleton />
    </PageSkeleton>
  ),
  component: EditCategoryRoute,
});

function EditCategoryRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  return <EditCategoryPage id={id} navigate={(to) => void navigate({ to })} />;
}

export function EditCategoryPage({ id, navigate }: { id: string; navigate?: (to: string) => void }) {
  const go = navigate ?? (() => undefined);
  const categoryQuery = useQuery(orpc.admin.categories.get.queryOptions({ input: { id } }));
  const categoriesListQuery = useQuery(orpc.admin.categories.list.queryOptions());

  if (categoryQuery.isLoading) {
    return (
      <PageSkeleton>
        <DetailSkeleton />
      </PageSkeleton>
    );
  }

  if (categoryQuery.isError || !categoryQuery.data) {
    return (
      <PageContainer size="default">
        <EmptyState
          title="Category not found"
          description={categoryQuery.error ? errorMessage(categoryQuery.error) : "This category does not exist."}
          action={
            <Button variant="outline" size="sm" onClick={() => go("/categories")}>
              Back to Categories
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return (
    <CategoryEditor
      key={categoryQuery.data.id}
      category={categoryQuery.data}
      categories={categoriesListQuery.data ?? []}
      go={go}
    />
  );
}

function CategoryEditor({
  category,
  categories,
  go,
}: {
  category: CategoryDetail;
  categories: Category[];
  go: (to: string) => void;
}) {
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const previewHref = storefrontLink(useStorefrontUrl(), `/categories/${category.slug}`);

  const updateMutation = useMutation(
    orpc.admin.categories.update.mutationOptions({
      onSuccess: () => {
        toast.success("Category updated successfully");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.key() });
        go("/categories");
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to update category"));
      },
    }),
  );

  const deleteMutation = useMutation(
    orpc.admin.categories.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Category deleted");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.key() });
        go("/categories");
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Could not delete category"));
      },
    }),
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title={category.name}
        description="Manage category details, hierarchical structure, and search engine listing."
        aside={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => go("/categories")}>
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Categories
            </Button>
            {previewHref ? (
              category.isActive ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={previewHref} target="_blank" rel="noopener noreferrer">
                    <Eye className="mr-1.5 size-3.5" aria-hidden />
                    Preview
                  </a>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled title="Inactive categories are hidden from the storefront">
                  <Eye className="mr-1.5 size-3.5" aria-hidden />
                  Preview
                </Button>
              )
            ) : null}
            <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} disabled={deleteMutation.isPending}>
              <Trash2 className="mr-1.5 size-3.5" aria-hidden />
              Delete
            </Button>
            <Button type="submit" form="category-form" size="sm" disabled={updateMutation.isPending}>
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        }
      />

      <CategoryForm
        formId="category-form"
        category={category}
        categories={categories}
        onSubmit={(v) =>
          updateMutation.mutate({
            id: category.id,
            name: v.name,
            slug: v.slug || undefined,
            description: v.description || null,
            parentId: v.parentId,
            imageMediaId: v.imageMediaId,
            position: v.position,
            isActive: v.isActive,
            isFeatured: v.isFeatured,
            type: v.type,
            match: v.match,
            rules: v.type === "automated" ? v.rules : null,
            sortOrder: v.sortOrder,
            ...(v.type === "manual" ? { productIds: v.productIds } : {}),
            seo: { title: v.seoTitle || undefined, description: v.seoDescription || undefined },
          })
        }
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Category?"
        description={`Are you sure you want to delete "${category.name}"? This action cannot be undone. Categories with subcategories or assigned products cannot be deleted.`}
        confirmLabel="Delete Category"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate({ id: category.id })}
      />
    </PageContainer>
  );
}
