export default function Loading() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6 lg:px-8 animate-pulse space-y-6">
      <div className="h-8 w-64 bg-muted rounded" />
      <div className="h-4 w-full bg-muted rounded" />
      <div className="h-64 w-full bg-muted rounded-xl" />
    </div>
  );
}
