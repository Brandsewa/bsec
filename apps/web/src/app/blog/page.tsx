import type { Metadata } from "next";
import { BlogArchivePage, blogArchiveMetadata } from "@/components/blog/BlogArchivePage.tsx";

export function generateMetadata(): Promise<Metadata> {
  return blogArchiveMetadata(undefined, 1);
}

export default function BlogIndexPage() {
  return <BlogArchivePage page={1} />;
}
