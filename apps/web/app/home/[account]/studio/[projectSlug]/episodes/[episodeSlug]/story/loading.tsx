export default function Loading() {
    return (
        <div className="p-8 animate-pulse">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div className="h-8 w-48 rounded-lg bg-gray-200 dark:bg-[#1A1A1A]" />
                <div className="h-10 w-32 rounded-lg bg-gray-200 dark:bg-[#1A1A1A]" />
            </div>

            {/* Story panel */}
            <div className="rounded-xl border border-gray-200 dark:border-white/5 dark:bg-[#1A1A1A]">
                {/* Section headers */}
                {[1, 2, 3].map((i) => (
                    <div key={i} className="border-b border-gray-100 p-6 dark:border-white/5">
                        <div className="mb-3 h-5 w-32 rounded bg-gray-200 dark:bg-[#252525]" />
                        <div className="space-y-2">
                            <div className="h-4 w-full rounded bg-gray-100 dark:bg-[#252525]" />
                            <div className="h-4 w-3/4 rounded bg-gray-100 dark:bg-[#252525]" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
