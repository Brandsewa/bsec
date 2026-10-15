import { createFileRoute } from "@tanstack/react-router";
import { DetailSkeleton, PageSkeleton } from "@bs/ui";
import { PostForm } from "../../../components/blog/PostForm.tsx";

export const Route = createFileRoute("/_store/online-store/blog_/new")({
  pendingComponent: () => (
    <PageSkeleton>
      <DetailSkeleton />
    </PageSkeleton>
  ),
  component: () => <PostForm />,
});
