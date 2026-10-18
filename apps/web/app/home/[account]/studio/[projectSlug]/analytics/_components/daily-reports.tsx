import 'server-only';

import ReactMarkdown, { type Components } from 'react-markdown';

import {
  type DailyReportItem,
  DailyReportsView,
} from '@kit/content-analytics/components/daily-reports';
import { listProjectReports } from '@kit/content-analytics/server/project-reports';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * FILM-1735. The Daily reports tab: the project's morning reports from the
 * last 60 days, read on the server through RLS and rendered as Markdown.
 * A report is its AI's text, which quotes the audience's comments, so raw
 * HTML in it is never rendered (react-markdown's default).
 */

const SHOWN_DAYS = 60;

export async function DailyReports({ projectId }: { projectId: string }) {
  const today = new Date();
  const from = new Date(today.getTime() - (SHOWN_DAYS - 1) * 86_400_000);
  // Tomorrow too: a report is dated in its own zone, which may be ahead
  const to = new Date(today.getTime() + 86_400_000);

  const reports = await listProjectReports(getSupabaseServerClient(), {
    projectId,
    from: isoDay(from),
    to: isoDay(to),
    withBody: true,
  });

  const items: DailyReportItem[] = reports.map((report) => ({
    id: report.id,
    date: report.date,
    timezone: report.timezone,
    model: report.model,
    createdAt: report.createdAt,
    headline: report.summary.headline ?? null,
    dataThrough: Object.entries(report.summary.dataThrough ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([platform, date]) => ({ platform, date })),
    body: (
      <div className="space-y-3 text-sm leading-6">
        <ReactMarkdown components={MARKDOWN}>{report.bodyMd}</ReactMarkdown>
      </div>
    ),
  }));

  return <DailyReportsView reports={items} />;
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** The repo has no typography plugin: each element is styled here */
const MARKDOWN: Components = {
  h1: ({ node: _node, ...props }) => (
    <h2 className="mt-6 text-xl font-semibold" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h3 className="mt-6 text-lg font-semibold" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h4 className="mt-4 font-semibold" {...props} />
  ),
  h4: ({ node: _node, ...props }) => (
    <h5 className="mt-4 font-medium" {...props} />
  ),
  p: ({ node: _node, ...props }) => (
    <p className="text-foreground/90" {...props} />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul className="list-disc space-y-1 pl-6" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="list-decimal space-y-1 pl-6" {...props} />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className="border-l-2 pl-4 text-muted-foreground italic"
      {...props}
    />
  ),
  a: ({ node: _node, ...props }) => (
    <a
      className="text-primary underline underline-offset-2"
      target="_blank"
      rel="noopener noreferrer nofollow"
      {...props}
    />
  ),
  code: ({ node: _node, ...props }) => (
    <code className="rounded bg-muted px-1 py-0.5 text-xs" {...props} />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre className="overflow-x-auto rounded bg-muted p-3 text-xs" {...props} />
  ),
  hr: () => <hr className="my-4" />,
};
