import type { Metadata } from "next";
import { BlogPostPage, blogPostMetadata } from "@/components/blog/BlogPostPage.tsx";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return blogPostMetadata((await params).slug);
}

export default async function BlogPostRoute({ params }: Props) {
  return <BlogPostPage slug={(await params).slug} />;
}
