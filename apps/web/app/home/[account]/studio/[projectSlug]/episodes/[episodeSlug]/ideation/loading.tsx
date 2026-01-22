export default function Loading() {
    return (
        <div className="p-8 animate-pulse">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div className="h-8 w-48 rounded-lg bg-gray-200 dark:bg-[#1A1A1A]" />
                <div className="h-10 w-36 rounded-lg bg-gray-200 dark:bg-[#1A1A1A]" />
            </div>

            {/* Settings panel */}
            <div className="mb-8 rounded-xl border border-gray-200 p-6 dark:border-white/5 dark:bg-[#1A1A1A]">
                <div className="h-24 w-full rounded-lg bg-gray-100 dark:bg-[#252525]" />
            </div>

            {/* Draft concept area */}
            <div className="mb-8 rounded-xl border border-gray-200 p-8 dark:border-white/5 dark:bg-[#1A1A1A]">
                <div className="mb-4 h-4 w-32 rounded bg-gray-200 dark:bg-[#252525]" />
                <div className="h-32 w-full rounded-lg bg-gray-100 dark:bg-[#252525]" />
            </div>

            {/* Idea cards grid */}
            <div className="grid gap-6 md:grid-cols-2">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="h-40 rounded-xl border border-gray-200 dark:border-white/5 dark:bg-[#1A1A1A]" />
                ))}
            </div>
        </div>
    );
}
