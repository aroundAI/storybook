'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Generation job status for announcements
 */
export interface AnnouncerJob {
  id: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  name?: string;
}

/**
 * Props for the StatusAnnouncer component
 */
export interface StatusAnnouncerProps {
  /** Array of generation jobs to monitor */
  jobs: AnnouncerJob[];
  /** Prefix for announcements (e.g., "Video", "Audio") */
  prefix?: string;
  /** Politeness level for announcements */
  politeness?: 'polite' | 'assertive';
}

/**
 * Live region component for announcing status changes to screen readers
 *
 * Monitors an array of jobs and announces when jobs complete or fail.
 * Uses ARIA live regions to announce changes without visual disruption.
 *
 * @example
 * ```tsx
 * function GenerationPanel({ jobs }) {
 *   return (
 *     <>
 *       <StatusAnnouncer jobs={jobs} prefix="Video" />
 *       <div>
 *         {jobs.map(job => (
 *           <JobCard key={job.id} job={job} />
 *         ))}
 *       </div>
 *     </>
 *   );
 * }
 * ```
 */
export function StatusAnnouncer({
  jobs,
  prefix = 'Generation',
  politeness = 'polite',
}: StatusAnnouncerProps) {
  const [announcement, setAnnouncement] = useState('');
  const previousJobsRef = useRef<Map<string, AnnouncerJob['status']>>(
    new Map(),
  );

  useEffect(() => {
    const previousJobs = previousJobsRef.current;
    const announcements: string[] = [];

    // Check for status changes
    for (const job of jobs) {
      const previousStatus = previousJobs.get(job.id);

      // Job just completed
      if (previousStatus !== 'completed' && job.status === 'completed') {
        const name = job.name ? ` "${job.name}"` : '';
        announcements.push(`${prefix}${name} completed successfully`);
      }

      // Job just failed
      if (previousStatus !== 'failed' && job.status === 'failed') {
        const name = job.name ? ` "${job.name}"` : '';
        announcements.push(`${prefix}${name} failed`);
      }

      // Update previous status
      previousJobs.set(job.id, job.status);
    }

    // Announce changes
    if (announcements.length > 0) {
      setAnnouncement(announcements.join('. '));

      // Clear announcement after a delay to allow re-announcement
      const timer = setTimeout(() => setAnnouncement(''), 1000);
      return () => clearTimeout(timer);
    }
  }, [jobs, prefix]);

  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  );
}

/**
 * Props for the useAnnounce hook
 */
export interface UseAnnounceOptions {
  /** Politeness level */
  politeness?: 'polite' | 'assertive';
  /** Clear delay in ms */
  clearDelay?: number;
}

/**
 * Hook for programmatically announcing messages to screen readers
 *
 * @example
 * ```tsx
 * function SaveButton() {
 *   const announce = useAnnounce();
 *
 *   const handleSave = async () => {
 *     await saveData();
 *     announce('Changes saved successfully');
 *   };
 *
 *   return <button onClick={handleSave}>Save</button>;
 * }
 * ```
 */
export function useAnnounce(options?: UseAnnounceOptions) {
  const { politeness = 'polite', clearDelay = 1000 } = options ?? {};
  const [message, setMessage] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback(
    (text: string) => {
      // Clear previous timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set new message
      setMessage(text);

      // Clear after delay
      timeoutRef.current = setTimeout(() => setMessage(''), clearDelay);
    },
    [clearDelay],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const AnnouncerRegion = function AnnouncerRegion() {
    return (
      <div
        role="status"
        aria-live={politeness}
        aria-atomic="true"
        className="sr-only"
      >
        {message}
      </div>
    );
  };

  return {
    announce,
    AnnouncerRegion,
  };
}

/**
 * Progress announcement component for long-running operations
 *
 * Announces progress updates at configurable intervals.
 */
export interface ProgressAnnouncerProps {
  /** Current progress (0-100) */
  progress: number;
  /** Label for the operation */
  label: string;
  /** Interval for announcements in percentage points (default: 25) */
  interval?: number;
  /** Whether to announce start and completion */
  announceStartEnd?: boolean;
}

export function ProgressAnnouncer({
  progress,
  label,
  interval = 25,
  announceStartEnd = true,
}: ProgressAnnouncerProps) {
  const [announcement, setAnnouncement] = useState('');
  const lastAnnouncedRef = useRef(-1);

  useEffect(() => {
    const roundedProgress = Math.round(progress);
    const lastAnnounced = lastAnnouncedRef.current;

    // Announce start
    if (announceStartEnd && lastAnnounced === -1 && roundedProgress > 0) {
      setAnnouncement(`${label} started`);
      lastAnnouncedRef.current = 0;
      return;
    }

    // Announce completion
    if (announceStartEnd && lastAnnounced < 100 && roundedProgress >= 100) {
      setAnnouncement(`${label} completed`);
      lastAnnouncedRef.current = 100;
      return;
    }

    // Announce interval progress
    const currentInterval = Math.floor(roundedProgress / interval) * interval;
    const lastInterval = Math.floor(lastAnnounced / interval) * interval;

    if (
      currentInterval > lastInterval &&
      currentInterval < 100 &&
      currentInterval > 0
    ) {
      setAnnouncement(`${label}: ${currentInterval}% complete`);
      lastAnnouncedRef.current = roundedProgress;
    }
  }, [progress, label, interval, announceStartEnd]);

  // Clear announcement after delay
  useEffect(() => {
    if (announcement) {
      const timer = setTimeout(() => setAnnouncement(''), 1000);
      return () => clearTimeout(timer);
    }
  }, [announcement]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  );
}
