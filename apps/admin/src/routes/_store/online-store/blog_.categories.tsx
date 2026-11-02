import { createFileRoute } from "@tanstack/react-router";
import { PageSkeleton } from "@bs/ui";
import { BlogCategoriesScreen } from "@bs/content-admin/blog/BlogCategoriesScreen.tsx";

export const Route = createFileRoute("/_store/online-store/blog_/categories")({
  pendingComponent: () => <PageSkeleton />,
  component: BlogCategoriesScreen,
});
