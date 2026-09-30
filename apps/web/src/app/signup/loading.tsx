/** Route skeleton matching signup/page.tsx so nothing shifts when content streams in. */
export default function SignupLoading() {
  return (
    <main aria-busy="true" className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div aria-hidden className="store-skeleton h-8 w-48 mx-auto" />
          <div aria-hidden className="store-skeleton h-4 w-64 mx-auto" />
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div aria-hidden className="store-skeleton h-10 w-full" />
          <div aria-hidden className="store-skeleton h-10 w-full" />
          <div aria-hidden className="store-skeleton h-10 w-full" />
        </div>
      </div>
    </main>
  );
}
