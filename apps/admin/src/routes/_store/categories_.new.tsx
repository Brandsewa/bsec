import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";
import { PageContainer, PageHeader, PageSkeleton, toast, Button } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CategoryForm } from "../../components/category/category-form.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/categories_/new")({
  pendingComponent: () => <PageSkeleton />,
  component: CreateCategoryPage,
});

export function CreateCategoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categoriesQuery = useQuery(orpc.admin.categories.list.queryOptions());

  const createMutation = useMutation(
    orpc.admin.categories.create.mutationOptions({
      onSuccess: () => {
        toast.success("Category created");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.categories.stats.key() });
        void navigate({ to: "/categories" });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to create category"));
      },
    }),
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title="Add category"
        description="Create a category to group related products."
        aside={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/categories" })}>
              <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
              Categories
            </Button>
            <Button type="submit" form="category-form" size="sm" disabled={createMutation.isPending}>
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {createMutation.isPending ? "Saving..." : "Save Category"}
            </Button>
          </div>
        }
      />

      <CategoryForm
        formId="category-form"
        categories={categoriesQuery.data ?? []}
        onSubmit={(v) =>
          createMutation.mutate({
            name: v.name,
            slug: v.slug || undefined,
            description: v.description || undefined,
            parentId: v.parentId,
            imageMediaId: v.imageMediaId,
            position: v.position,
            isActive: v.isActive,
            isFeatured: v.isFeatured,
            type: v.type,
            match: v.match,
            rules: v.type === "automated" ? v.rules : undefined,
            sortOrder: v.sortOrder,
            ...(v.type === "manual" ? { productIds: v.productIds } : {}),
            seo: v.seoTitle || v.seoDescription ? { title: v.seoTitle || null, description: v.seoDescription || null } : undefined,
          })
        }
      />
    </PageContainer>
  );
}
