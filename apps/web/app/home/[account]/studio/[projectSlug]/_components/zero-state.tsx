export function ZeroState() {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      {/* Choose Your Genesis */}
      <div className="space-y-6 lg:col-span-2">
        <div className="cinema-panel p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <svg
              className="h-6 w-6 text-indigo-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <h2 className="text-lg font-semibold text-foreground">
              Choose Your Genesis
            </h2>
          </div>
          <p className="mb-8 text-sm text-muted-foreground">
            Your studio is set up. How would you like to begin your first
            episode?
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Template */}
            <button className="group flex h-full flex-col items-start rounded-xl border border-border bg-muted p-5 text-left transition-all duration-200 hover:border-indigo-300 hover:bg-card hover:shadow-md dark:hover:border-indigo-500">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 transition-transform group-hover:scale-110 dark:bg-blue-900/40 dark:text-blue-400">
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
                    d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                  />
                </svg>
              </div>
              <h3 className="mb-1 font-semibold text-foreground">
                Use a Template
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Start with a proven structure for 11min or 22min animated
                episodes.
              </p>
            </button>
            {/* Import */}
            <button className="group flex h-full flex-col items-start rounded-xl border border-border bg-muted p-5 text-left transition-all duration-200 hover:border-indigo-300 hover:bg-card hover:shadow-md dark:hover:border-indigo-500">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 transition-transform group-hover:scale-110 dark:bg-emerald-900/40 dark:text-emerald-400">
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
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
              </div>
              <h3 className="mb-1 font-semibold text-foreground">
                Import Script
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Upload a Final Draft (.fdx) or PDF file to auto-generate scenes.
              </p>
            </button>
            {/* AI Brainstorm */}
            <button className="group flex h-full flex-col items-start rounded-xl border border-border bg-muted p-5 text-left transition-all duration-200 hover:border-indigo-300 hover:bg-card hover:shadow-md dark:hover:border-indigo-500">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600 transition-transform group-hover:scale-110 dark:bg-purple-900/40 dark:text-purple-400">
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
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
              </div>
              <h3 className="mb-1 font-semibold text-foreground">
                Brainstorm with AI
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Collaborate with our creative AI to develop a concept from
                scratch.
              </p>
            </button>
          </div>
        </div>
      </div>
      {/* Production Health Empty */}
      <div className="lg:col-span-1">
        <div className="flex h-full flex-col rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg
                className="h-4 w-4 text-indigo-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <h2 className="text-sm font-semibold text-foreground">
                Production Health
              </h2>
            </div>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <svg
                className="h-8 w-8 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
                />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-medium text-foreground">
              No episodes yet
            </h3>
            <p className="max-w-[200px] text-xs text-muted-foreground">
              Once you start creating, your production metrics will appear here.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
