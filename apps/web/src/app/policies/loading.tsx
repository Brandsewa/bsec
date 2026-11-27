export default function Loading() {
  return (
    <main aria-busy="true" className="mx-auto max-w-4xl px-4 py-12">
      <div className="mb-8 pb-6 space-y-3">
        <div aria-hidden className="store-skeleton h-10 w-56 max-w-full" />
        <div aria-hidden className="store-skeleton h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-3">
        <div aria-hidden className="store-skeleton h-12 w-full" />
        <div aria-hidden className="store-skeleton h-12 w-full" />
        <div aria-hidden className="store-skeleton h-12 w-full" />
        <div aria-hidden className="store-skeleton h-12 w-full" />
      </div>
    </main>
  );
}
