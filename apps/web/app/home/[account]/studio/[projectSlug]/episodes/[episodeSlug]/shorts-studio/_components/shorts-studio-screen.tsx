import { Suspense } from 'react';

import { Loader2 } from 'lucide-react';

import { ShortsCandidatesList, ShortsGallery } from '@kit/shorts/components';
import { getShortsCandidates, getShortsForEpisode } from '@kit/shorts/server';

interface ShortsStudioScreenProps {
  episodeId: string;
  projectSlug: string;
  accountSlug: string;
}

async function ShortsCandidatesSection({ episodeId }: { episodeId: string }) {
  const candidates = await getShortsCandidates(episodeId);

  return <ShortsCandidatesList candidates={candidates} episodeId={episodeId} />;
}

async function ShortsGallerySection({ episodeId }: { episodeId: string }) {
  const shorts = await getShortsForEpisode(episodeId);

  return <ShortsGallery shorts={shorts} />;
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center p-8">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  );
}

export async function ShortsStudioScreen({
  episodeId,
}: ShortsStudioScreenProps) {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Shorts Studio
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Generate and publish 9:16 vertical clips for TikTok, Reels, and
            YouTube Shorts
          </p>
        </div>

        {/* Two-column layout */}
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Candidates sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
                Shorts Candidates
              </h2>
              <Suspense fallback={<LoadingFallback />}>
                <ShortsCandidatesSection episodeId={episodeId} />
              </Suspense>
            </div>
          </div>

          {/* Gallery main area */}
          <div className="lg:col-span-2">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              Generated Shorts
            </h2>
            <Suspense fallback={<LoadingFallback />}>
              <ShortsGallerySection episodeId={episodeId} />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
