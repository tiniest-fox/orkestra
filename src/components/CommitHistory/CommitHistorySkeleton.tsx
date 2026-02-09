export function CommitHistorySkeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="px-3 py-2.5 border-b border-stone-100 dark:border-stone-800">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="h-3.5 w-14 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
            <div className="h-3.5 w-10 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
          </div>
          <div className="h-4 w-48 bg-stone-200 dark:bg-stone-700 rounded animate-pulse mt-1" />
          <div className="flex items-center gap-2 mt-1">
            <div className="h-3 w-20 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
            <div className="h-3 w-12 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </>
  );
}
