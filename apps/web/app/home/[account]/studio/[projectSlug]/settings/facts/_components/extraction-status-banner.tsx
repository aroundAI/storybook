'use client';

import { useEffect, useState } from 'react';

import { Loader2 } from 'lucide-react';

import { getExtractionStatusAction } from '@kit/episodes/server';

interface ExtractionJob {
  id: string;
  source_title: string;
  chunk_count: number;
  chunks_completed: number;
  status: string;
  facts_extracted: number;
  created_at: string;
}

interface ExtractionStatusBannerProps {
  projectId: string;
}

export function ExtractionStatusBanner({
  projectId,
}: ExtractionStatusBannerProps) {
  const [jobs, setJobs] = useState<ExtractionJob[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const result = await getExtractionStatusAction({ projectId });

        if (result && typeof result === 'object' && 'jobs' in result) {
          const activeJobs = (result as { jobs: ExtractionJob[] }).jobs;
          setJobs(activeJobs);
        }
      } catch {
        // Silently ignore - table might not exist yet
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 10_000);

    return () => clearInterval(interval);
  }, [projectId]);

  if (dismissed || jobs.length === 0) {
    return null;
  }

  const totalChunks = jobs.reduce((sum, j) => sum + j.chunk_count, 0);
  const completedChunks = jobs.reduce(
    (sum, j) => sum + j.chunks_completed,
    0,
  );
  const totalFacts = jobs.reduce((sum, j) => sum + j.facts_extracted, 0);

  return (
    <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
      <div className="flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        <div className="text-sm">
          <span className="font-medium text-blue-800 dark:text-blue-300">
            Processing {jobs.length} extraction job
            {jobs.length !== 1 ? 's' : ''}
          </span>
          <span className="text-blue-600 dark:text-blue-400">
            {' '}
            — {completedChunks}/{totalChunks} chunks complete
            {totalFacts > 0 && `, ${totalFacts} facts extracted so far`}
          </span>
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
      >
        Dismiss
      </button>
    </div>
  );
}
