import { useEffect, useMemo } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { MediaKind } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";
import { mediaUploadQueue } from "../../lib/media-upload-queue.ts";
import type { MediaSort, MediaUsageFilter } from "./media-filters-bar.tsx";

export interface UseMediaListOptions {
  q?: string | undefined;
  kinds?: MediaKind[] | undefined;
  usage?: MediaUsageFilter | undefined;
  sort?: MediaSort | undefined;
  trash?: boolean | undefined;
  limit?: number | undefined;
  enabled?: boolean | undefined;
}

export function useMediaList({
  q = "",
  kinds,
  usage = "any",
  sort = "newest",
  trash = false,
  limit = 40,
  enabled = true,
}: UseMediaListOptions = {}) {
  const queryClient = useQueryClient();
  const rawQ = q.trim();

  const query = useInfiniteQuery({
    queryKey: [
      "admin",
      "media",
      "list",
      {
        q: rawQ,
        kinds,
        usage,
        sort,
        trash,
        limit,
      },
    ],
    queryFn: ({ pageParam }) =>
      client.admin.media.list({
        cursor: pageParam ?? undefined,
        limit,
        q: rawQ || undefined,
        kinds,
        usage: usage === "any" ? undefined : usage,
        sort,
        trash,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });

  const items = useMemo(() => {
    return query.data?.pages.flatMap((page) => page.items) ?? [];
  }, [query.data]);

  const totalCount = query.data?.pages[0]?.total ?? 0;

  // Invalidate when new uploads complete
  useEffect(() => {
    return mediaUploadQueue.onUploadSuccess(() => {
      queryClient.invalidateQueries({ queryKey: ["admin", "media", "list"] });
    });
  }, [queryClient]);

  return {
    query,
    items,
    totalCount,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}
