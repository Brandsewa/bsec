import { createFileRoute } from "@tanstack/react-router";
import { PageSkeleton } from "@bs/ui";
import { BlogPostsScreen, validateBlogListSearch } from "@bs/content-admin/blog/BlogPostsScreen.tsx";

export const Route = createFileRoute("/_store/online-store/blog")({
  validateSearch: validateBlogListSearch,
  pendingComponent: () => <PageSkeleton />,
  component: BlogPostsRoute,
});

function BlogPostsRoute() {
  return <BlogPostsScreen search={Route.useSearch()} />;
}
