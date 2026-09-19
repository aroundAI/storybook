import Link from 'next/link';

interface StatsCardsProps {
  episodeCount: number;
  characterCount: number;
  locationCount: number;
  baseUrl: string;
}

export function StatsCards({
  episodeCount,
  characterCount,
  locationCount,
  baseUrl,
}: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {/* Episodes stat */}
      <Link href={`${baseUrl}/episodes`} className="group cinema-panel p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="mb-1 text-sm font-medium text-muted-foreground">
              Total Episodes
            </p>
            <h3 className="text-4xl font-semibold tracking-tight text-foreground">
              {episodeCount}
            </h3>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
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
                d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
              />
            </svg>
          </div>
        </div>
      </Link>

      {/* Characters stat */}
      <Link href={`${baseUrl}/assets`} className="group cinema-panel p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="mb-1 text-sm font-medium text-muted-foreground">
              Characters
            </p>
            <h3 className="text-4xl font-semibold tracking-tight text-foreground">
              {characterCount}
            </h3>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-50 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400">
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
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          </div>
        </div>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-[70%] rounded-full bg-purple-500" />
        </div>
      </Link>

      {/* Locations stat */}
      <Link href={`${baseUrl}/assets`} className="group cinema-panel p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="mb-1 text-sm font-medium text-muted-foreground">
              Locations
            </p>
            <h3 className="text-4xl font-semibold tracking-tight text-foreground">
              {locationCount}
            </h3>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pink-50 text-pink-600 dark:bg-pink-500/20 dark:text-pink-400">
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
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
        </div>
        <div className="mt-4 flex -space-x-2 overflow-hidden">
          <div className="inline-block h-6 w-6 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 ring-2 ring-card" />
          <div className="inline-block h-6 w-6 rounded-full bg-gradient-to-br from-blue-400 to-cyan-500 ring-2 ring-card" />
          <div className="inline-block h-6 w-6 rounded-full bg-gradient-to-br from-pink-400 to-rose-500 ring-2 ring-card" />
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-card">
            +{Math.max(0, locationCount - 3)}
          </div>
        </div>
      </Link>
    </div>
  );
}
