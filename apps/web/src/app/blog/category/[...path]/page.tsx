import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { BlogArchivePage, blogArchiveMetadata } from "@/components/blog/BlogArchivePage.tsx";

interface Props {
  params: Promise<{ path: string[] }>;
}

/** /blog/category/<parent>[/<child>][/page/<n>] */
function parse(segments: string[]): { categoryPath: string; page: number } | null {
  const segs = segments.map((s) => decodeURIComponent(s));
  let page = 1;
  const i = segs.indexOf("page");
  if (i >= 0) {
    if (i !== segs.length - 2 || !/^\d{1,4}$/.test(segs[i + 1] ?? "")) return null;
    page = Number(segs[i + 1]);
    segs.splice(i);
  }
  if (segs.length < 1 || segs.length > 2) return null;
  return { categoryPath: segs.join("/"), page };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const parsed = parse((await params).path);
  return parsed ? blogArchiveMetadata(parsed.categoryPath, parsed.page) : { title: "Not found", robots: { index: false } };
}

export default async function BlogCategoryPage({ params }: Props) {
  const parsed = parse((await params).path);
  if (!parsed || parsed.page < 1) notFound();
  // The first page lives at the category address itself.
  if (parsed.page === 1 && (await params).path.includes("page")) permanentRedirect(`/blog/category/${parsed.categoryPath}`);
  return <BlogArchivePage categoryPath={parsed.categoryPath} page={parsed.page} />;
}
