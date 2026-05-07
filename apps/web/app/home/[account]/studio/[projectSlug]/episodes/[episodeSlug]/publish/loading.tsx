export default function Loading() {
  return (
    <div className="animate-pulse p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="mb-2 h-8 w-48 rounded-lg bg-gray-200 dark:bg-[#1A1A1A]" />
          <div className="h-4 w-64 rounded bg-gray-100 dark:bg-[#252525]" />
        </div>
        <div className="h-10 w-32 rounded-lg bg-gray-200 dark:bg-[#3B82F6]/30" />
      </div>

      <div className="flex gap-6">
        {/* Video cards */}
        <div className="flex-1 space-y-4">
          <div className="h-6 w-32 rounded bg-gray-200 dark:bg-[#1A1A1A]" />
          <div className="flex gap-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="flex-1 rounded-xl border border-gray-200 dark:border-white/5 dark:bg-[#1A1A1A]"
              >
                <div className="aspect-video w-full rounded-t-xl bg-gray-200 dark:bg-[#252525]" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-24 rounded bg-gray-200 dark:bg-[#252525]" />
                  <div className="h-8 w-32 rounded bg-gray-100 dark:bg-[#252525]" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Settings panel */}
        <div className="w-80 rounded-xl border border-gray-200 p-4 dark:border-white/5 dark:bg-[#1A1A1A]">
          <div className="mb-4 h-6 w-32 rounded bg-gray-200 dark:bg-[#252525]" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-10 w-full rounded-lg bg-gray-100 dark:bg-[#252525]"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
