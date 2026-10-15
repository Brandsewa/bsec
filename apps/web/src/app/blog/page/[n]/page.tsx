import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { BlogArchivePage, blogArchiveMetadata } from "@/components/blog/BlogArchivePage.tsx";

interface Props {
  params: Promise<{ n: string }>;
}

function pageNumber(raw: string): number | null {
  return /^\d{1,4}$/.test(raw) ? Number(raw) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = pageNumber((await params).n);
  return n && n > 1 ? blogArchiveMetadata(undefined, n) : { title: "Not found", robots: { index: false } };
}

export default async function BlogPageNumber({ params }: Props) {
  const n = pageNumber((await params).n);
  if (!n || n < 1) notFound();
  if (n === 1) permanentRedirect("/blog");
  return <BlogArchivePage page={n} />;
}
