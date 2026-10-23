import React from "react";

export default function CollectionsLoading() {
  return (
    <div className="mx-auto w-full max-w-[80rem] px-4 py-8">
      <div aria-hidden className="store-skeleton mx-auto mb-8 h-8 w-56 rounded" />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} aria-hidden className="store-skeleton aspect-[4/3] w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
