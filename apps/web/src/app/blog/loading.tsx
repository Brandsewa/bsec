export default function Loading() {
  return (
    <main aria-busy="true" className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-12 text-center space-y-3">
        <div aria-hidden className="store-skeleton h-12 w-64 mx-auto" />
        <div aria-hidden className="store-skeleton h-5 w-96 max-w-full mx-auto" />
      </div>
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col rounded-xl border border-border p-6 space-y-4">
            <div aria-hidden className="store-skeleton h-4 w-28" />
            <div aria-hidden className="store-skeleton h-6 w-full" />
            <div aria-hidden className="store-skeleton h-16 w-full" />
            <div aria-hidden className="store-skeleton h-4 w-20 pt-2" />
          </div>
        ))}
      </div>
    </main>
  );
}
