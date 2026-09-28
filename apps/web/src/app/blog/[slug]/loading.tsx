export default function Loading() {
  return (
    <main aria-busy="true" className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <div aria-hidden className="store-skeleton h-4 w-32" />
      </div>
      <header className="mb-10 pb-8 border-b border-border space-y-4">
        <div aria-hidden className="store-skeleton h-4 w-48" />
        <div aria-hidden className="store-skeleton h-12 w-full" />
        <div aria-hidden className="store-skeleton h-6 w-3/4" />
      </header>
      <div className="space-y-4">
        <div aria-hidden className="store-skeleton h-5 w-full" />
        <div aria-hidden className="store-skeleton h-5 w-full" />
        <div aria-hidden className="store-skeleton h-5 w-4/5" />
      </div>
    </main>
  );
}
