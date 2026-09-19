interface HealthDonutProps {
  scriptPercent: number;
  storyboardPercent: number;
  visualPercent: number;
  overallPercent: number;
}

export function HealthDonut({
  scriptPercent,
  storyboardPercent,
  visualPercent,
  overallPercent,
}: HealthDonutProps) {
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 text-green-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
          <h2 className="font-semibold text-foreground">Health</h2>
        </div>
        <button className="text-muted-foreground hover:text-foreground">
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"
            />
          </svg>
        </button>
      </div>
      {/* Conic Gradient Donut */}
      <div className="flex flex-1 flex-col items-center justify-center py-6">
        <div
          className="relative flex h-32 w-32 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(
              #F59E0B 0% ${scriptPercent * 0.85}%,
              #A855F7 ${scriptPercent * 0.85}% ${(scriptPercent + storyboardPercent) * 0.85}%,
              #3B82F6 ${(scriptPercent + storyboardPercent) * 0.85}% ${overallPercent}%,
              #E5E7EB ${overallPercent}% 100%
            )`,
          }}
        >
          <div className="z-10 flex h-24 w-24 flex-col items-center justify-center rounded-full bg-card shadow-sm">
            <span className="text-2xl font-bold text-foreground">
              {overallPercent}%
            </span>
            <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Complete
            </span>
          </div>
        </div>
      </div>
      {/* Legend */}
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-yellow-500" />
            <span className="text-muted-foreground">Scripting</span>
          </div>
          <span className="font-medium text-foreground">{scriptPercent}%</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-purple-500" />
            <span className="text-muted-foreground">Storyboards</span>
          </div>
          <span className="font-medium text-foreground">
            {storyboardPercent}%
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Animation</span>
          </div>
          <span className="font-medium text-foreground">{visualPercent}%</span>
        </div>
      </div>
    </div>
  );
}
