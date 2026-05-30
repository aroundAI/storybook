import Link from 'next/link';

interface HeroBannerProps {
  projectName: string;
  projectDescription?: string | null;
  backdropUrl: string;
  targetAudience?: string;
  settingsUrl: string;
}

export function HeroBanner({
  projectName,
  projectDescription,
  backdropUrl,
  targetAudience,
  settingsUrl,
}: HeroBannerProps) {
  return (
    <section className="group relative h-64 overflow-hidden rounded-2xl shadow-sm md:h-80">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt="Project background"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
        src={backdropUrl}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
      <div className="absolute bottom-0 left-0 flex w-full flex-col justify-between gap-4 p-8 md:flex-row md:items-end">
        <div>
          <div className="mb-3 flex items-center gap-3">
            {targetAudience && (
              <span className="rounded-md border border-white/10 bg-white/20 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md">
                Ages {targetAudience}+
              </span>
            )}
            <span className="h-1 w-1 rounded-full bg-white/60" />
            <span className="text-sm text-white/80">Updated 2h ago</span>
          </div>
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-white md:text-5xl">
            {projectName}
          </h1>
          {projectDescription && (
            <p className="line-clamp-2 max-w-xl text-white/70">
              {projectDescription}
            </p>
          )}
        </div>
        <Link
          href={settingsUrl}
          className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition-all hover:bg-white/20"
        >
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
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
          Edit Details
        </Link>
      </div>
    </section>
  );
}
