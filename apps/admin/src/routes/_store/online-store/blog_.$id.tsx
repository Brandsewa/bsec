import { createFileRoute } from "@tanstack/react-router";
import { DetailSkeleton, PageSkeleton } from "@bs/ui";
import { PostForm } from "../../../components/blog/PostForm.tsx";

export const Route = createFileRoute("/_store/online-store/blog_/$id")({
  pendingComponent: () => (
    <PageSkeleton>
      <DetailSkeleton />
    </PageSkeleton>
  ),
  component: EditPostRoute,
});

function EditPostRoute() {
  const { id } = Route.useParams();
  return <PostForm postId={id} />;
}
