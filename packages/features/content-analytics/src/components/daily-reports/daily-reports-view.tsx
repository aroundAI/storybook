'use client';

import { type ReactNode, useState } from 'react';

import { CalendarDays, FileText } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  EmptyState,
  EmptyStateHeading,
  EmptyStateText,
} from '@kit/ui/empty-state';
import { cn } from '@kit/ui/utils';

import { platformLabel } from '../../lib/platform-labels';

/**
 * FILM-1735. The project's saved morning reports: a list of days, and the
 * chosen day's report as its AI wrote it. The text is rendered on the
 * server and handed in as `body`; this only chooses which day to show.
 */

export interface DailyReportItem {
  id: string;
  date: string;
  timezone: string;
  model: string;
  createdAt: string;
  headline: string | null;
  /** Platform → the last day its data covers, as the digest said */
  dataThrough: Array<{ platform: string; date: string }>;
  body: ReactNode;
}

export function DailyReportsView({ reports }: { reports: DailyReportItem[] }) {
  const [selectedId, setSelectedId] = useState(reports[0]?.id);
  const selected = reports.find((r) => r.id === selectedId) ?? reports[0];

  if (!selected) {
    return (
      <EmptyState data-test="daily-reports-empty">
        <EmptyStateHeading>No daily reports yet</EmptyStateHeading>
        <EmptyStateText>
          A morning routine in Claude Desktop writes one for this project each
          day over the StoryBook connector (get_daily_digest, then
          save_project_report). Saved reports appear here, one per day.
        </EmptyStateText>
      </EmptyState>
    );
  }

  return (
    <div
      className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]"
      data-test="daily-reports"
    >
      <nav aria-label="Report days" className="flex flex-col gap-1">
        {reports.map((report) => (
          <button
            key={report.id}
            type="button"
            onClick={() => setSelectedId(report.id)}
            aria-current={report.id === selected.id ? 'date' : undefined}
            data-test={`daily-report-day-${report.date}`}
            className={cn(
              'hover:bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm',
              report.id === selected.id && 'bg-muted font-medium',
            )}
          >
            <CalendarDays className="text-muted-foreground h-4 w-4 shrink-0" />
            {formatDay(report.date)}
          </button>
        ))}
      </nav>

      <Card data-test="daily-report" data-report-date={selected.date}>
        <CardHeader className="space-y-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            {formatDay(selected.date)}
          </CardTitle>
          {selected.headline && (
            <p className="text-muted-foreground text-sm">{selected.headline}</p>
          )}
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" data-test="daily-report-timezone">
              Day in {selected.timezone}
            </Badge>
            <Badge variant="outline" data-test="daily-report-model">
              Written by {selected.model}
            </Badge>
            {selected.dataThrough.map(({ platform, date }) => (
              <Badge
                key={platform}
                variant="secondary"
                data-test={`daily-report-data-through-${platform}`}
              >
                {platformLabel(platform)} data through {date}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent data-test="daily-report-body">{selected.body}</CardContent>
      </Card>
    </div>
  );
}

/** A calendar day as written, never shifted by the viewer's zone */
function formatDay(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
