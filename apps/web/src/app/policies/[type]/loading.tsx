export default function Loading() {
  return (
    <main aria-busy="true" className="mx-auto max-w-4xl px-4 py-12">
      <div className="mb-8 border-b border-border pb-6 space-y-3">
        <div aria-hidden className="store-skeleton h-10 w-64 max-w-full" />
        <div aria-hidden className="store-skeleton h-4 w-32" />
      </div>
      <div className="space-y-4">
        <div aria-hidden className="store-skeleton h-5 w-full" />
        <div aria-hidden className="store-skeleton h-5 w-5/6" />
        <div aria-hidden className="store-skeleton h-5 w-4/6" />
      </div>
    </main>
  );
}
