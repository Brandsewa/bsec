import type { Metadata } from "next";
import { BlogPostPage, blogPostMetadata } from "@/components/blog/BlogPostPage.tsx";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string | string[] }>;
}

const tokenOf = (v: string | string[] | undefined) => (typeof v === "string" && v.length < 200 ? v : undefined);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  return blogPostMetadata((await params).slug, tokenOf((await searchParams).preview));
}

export default async function BlogPostRoute({ params, searchParams }: Props) {
  return <BlogPostPage slug={(await params).slug} previewToken={tokenOf((await searchParams).preview)} />;
}
