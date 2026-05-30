import Link from 'next/link';

import { formatDistanceToNow } from 'date-fns';

import type { Episode } from './overview-constants';
import { GRADIENTS, STAGE_COLORS, STAGE_PROGRESS } from './overview-constants';

interface JumpBackInSectionProps {
  recentEpisodes: Episode[];
  baseUrl: string;
}

export function JumpBackInSection({
  recentEpisodes,
  baseUrl,
}: JumpBackInSectionProps) {
  return (
    <div className="border-border bg-card flex flex-col rounded-xl border shadow-sm lg:col-span-2">
      <div className="border-border flex items-center justify-between border-b p-5">
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 text-indigo-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h2 className="text-foreground text-lg font-semibold">
            Jump Back In
          </h2>
        </div>
        <Link
          href={`${baseUrl}/episodes`}
          className="flex items-center gap-1 text-sm font-medium text-indigo-500 hover:text-indigo-600"
        >
          View All
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </Link>
      </div>
      <div className="p-2">
        {recentEpisodes.map((episode, index) => {
          const stage = episode.stage ?? 'draft';
          const colors = STAGE_COLORS[stage] ?? STAGE_COLORS.draft!;
          const progress = STAGE_PROGRESS[stage] ?? 15;
          const gradient = GRADIENTS[index % GRADIENTS.length];

          return (
            <Link
              key={episode.id}
              href={`${baseUrl}/episodes/${episode.id}`}
              className="group hover:border-border hover:bg-muted flex cursor-pointer items-center gap-4 rounded-lg border border-transparent p-3 transition-colors"
            >
              {/* Thumbnail */}
              <div
                className={`h-16 w-24 rounded-lg bg-gradient-to-br ${gradient} relative flex-shrink-0 overflow-hidden shadow-sm`}
              >
                {episode.thumbnailUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    alt=""
                    className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                    src={episode.thumbnailUrl}
                  />
                ) : null}
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                  <svg
                    className="h-6 w-6 text-white drop-shadow-md"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-start justify-between">
                  <h3 className="text-foreground truncate font-semibold">
                    {episode.title || `Episode ${episode.number}`}
                  </h3>
                  <span className="text-muted-foreground ml-2 text-xs whitespace-nowrap">
                    {formatDistanceToNow(new Date(episode.updated_at), {
                      addSuffix: false,
                    })}
                  </span>
                </div>
                <p className="text-muted-foreground mb-2 text-xs">
                  EP{String(episode.number).padStart(2, '0')}{' '}
                  {episode.seasonNumber
                    ? `• Season ${episode.seasonNumber}`
                    : ''}
                </p>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${colors.badge}`}
                  >
                    {stage.charAt(0).toUpperCase() + stage.slice(1)}
                  </span>
                  <div className="bg-muted h-1 max-w-[100px] flex-1 overflow-hidden rounded-full">
                    <div
                      className={`h-full rounded-full ${colors.bar}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
