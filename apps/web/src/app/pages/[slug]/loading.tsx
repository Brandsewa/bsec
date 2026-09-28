export default function Loading() {
  return (
    <main aria-busy="true" className="w-full min-h-[60vh] mx-auto max-w-4xl px-4 py-10 space-y-6">
      <div aria-hidden className="store-skeleton h-12 w-80 max-w-full" />
      <div className="space-y-4 pt-4">
        <div aria-hidden className="store-skeleton h-48 w-full rounded-xl" />
        <div aria-hidden className="store-skeleton h-32 w-full rounded-xl" />
      </div>
    </main>
  );
}
