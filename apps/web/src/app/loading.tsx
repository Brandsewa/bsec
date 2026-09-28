/** Route skeleton matching page.tsx so nothing shifts when content streams in. */
export default function Loading() {
  return (
    <main aria-busy="true" className="mx-auto grid max-w-5xl gap-8 px-4 py-10">
      <div className="flex items-center justify-between">
        <div aria-hidden className="store-skeleton h-6 w-32" />
        <div aria-hidden className="store-skeleton h-6 w-16" />
      </div>
      <div className="grid gap-3">
        <div aria-hidden className="store-skeleton h-9 w-72" />
        <div aria-hidden className="store-skeleton h-5 w-96 max-w-full" />
      </div>
    </main>
  );
}
