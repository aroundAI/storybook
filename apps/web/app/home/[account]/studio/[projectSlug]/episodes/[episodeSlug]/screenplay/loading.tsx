export default function Loading() {
    return (
        <div className="p-8 animate-pulse">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div className="h-8 w-48 rounded-lg bg-gray-200 dark:bg-[#1A1A1A]" />
                <div className="h-10 w-36 rounded-lg bg-gray-200 dark:bg-[#1A1A1A]" />
            </div>

            {/* Scene cards */}
            <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="rounded-xl border border-gray-200 dark:border-white/5 dark:bg-[#1A1A1A]">
                        {/* Scene header */}
                        <div className="flex items-center gap-3 border-b border-gray-100 p-4 dark:border-white/5 dark:bg-[#252525]">
                            <div className="h-6 w-6 rounded bg-gray-300 dark:bg-[#3B82F6]" />
                            <div className="h-5 w-48 rounded bg-gray-200 dark:bg-[#1A1A1A]" />
                        </div>
                        {/* Dialogue blocks */}
                        <div className="space-y-3 p-4">
                            {[1, 2].map((j) => (
                                <div key={j} className="flex gap-3">
                                    <div className="h-4 w-24 rounded bg-gray-200 dark:bg-[#252525]" />
                                    <div className="h-4 flex-1 rounded bg-gray-100 dark:bg-[#252525]" />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
