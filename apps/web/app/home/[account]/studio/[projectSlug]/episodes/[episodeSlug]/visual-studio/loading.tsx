export default function Loading() {
    return (
        <div className="p-8 animate-pulse">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div className="h-8 w-48 rounded-lg bg-gray-200 dark:bg-[#1A1A1A]" />
                <div className="flex gap-3">
                    <div className="h-10 w-32 rounded-lg bg-gray-200 dark:bg-[#1A1A1A]" />
                    <div className="h-10 w-32 rounded-lg bg-gray-200 dark:bg-[#3B82F6]/30" />
                </div>
            </div>

            {/* Shot grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="rounded-xl border border-gray-200 dark:border-white/5 dark:bg-[#1A1A1A]">
                        {/* Thumbnail area */}
                        <div className="aspect-video w-full rounded-t-xl bg-gray-200 dark:bg-[#252525]" />
                        {/* Shot info */}
                        <div className="space-y-2 p-4">
                            <div className="flex items-center gap-2">
                                <div className="h-6 w-8 rounded bg-gray-300 dark:bg-[#3B82F6]" />
                                <div className="h-4 w-24 rounded bg-gray-200 dark:bg-[#252525]" />
                            </div>
                            <div className="h-3 w-full rounded bg-gray-100 dark:bg-[#252525]" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
