export default function Loading() {
  return (
    <div className="flex h-full animate-pulse">
      {/* Main content */}
      <div className="flex-1 p-4">
        {/* Header bar */}
        <div className="mb-4 flex items-center gap-3 rounded-lg bg-gray-100 p-3 dark:bg-[#111111]">
          <div className="flex gap-2">
            <div className="h-8 w-20 rounded-md bg-gray-200 dark:bg-[#3B82F6]/30" />
            <div className="h-8 w-16 rounded-md bg-gray-200 dark:bg-[#1A1A1A]" />
            <div className="h-8 w-16 rounded-md bg-gray-200 dark:bg-[#1A1A1A]" />
          </div>
        </div>

        {/* Timeline */}
        <div className="rounded-xl border border-gray-200 dark:border-white/5 dark:bg-[#1A1A1A]">
          {/* Time ruler */}
          <div className="flex h-8 items-center border-b border-gray-100 px-4 dark:border-white/5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex-1 text-center">
                <div className="mx-auto h-3 w-8 rounded bg-gray-200 dark:bg-[#252525]" />
              </div>
            ))}
          </div>

          {/* Dialogue items */}
          <div className="space-y-2 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-[#252525]" />
                <div className="h-12 flex-1 rounded-lg bg-gray-100 dark:bg-[#252525]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
