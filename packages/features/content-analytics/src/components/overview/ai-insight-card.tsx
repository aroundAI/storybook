'use client';

import { ArrowRight, CheckCircle, Lightbulb, Sparkles } from 'lucide-react';

import { AnalyticsCard } from './analytics-card';
import type { CardClaim } from './card-claim';

interface AIInsightCardProps {
  /**
   * Plain text, rendered as text. This was markup passed to
   * `dangerouslySetInnerHTML`; its one caller only ever built it from two
   * formatted numbers, but a model's reading handed to it would have run
   * whatever the model wrote.
   */
  summary: string;
  /**
   * Who wrote `summary`. `page` when it restates this page's own figures —
   * the only case today, since nothing passes the grid a model's reading —
   * and the card then says so rather than calling it AI.
   */
  author?: 'model' | 'page';
  /** Key insights/bullets */
  insights?: Array<{
    type: 'success' | 'opportunity';
    text: string;
  }>;
  /** Optional link to full report */
  onViewReport?: () => void;
}

const BY_AUTHOR = {
  model: {
    title: 'AI Performance Insight',
    metricFamily: 'generated',
    claim: {
      figure: null,
      noFigure: 'Not a measurement.',
      sentence: 'A language model’s reading of the figures on this page.',
    },
  },
  page: {
    title: 'Performance summary',
    metricFamily: 'summary',
    claim: {
      figure: null,
      noFigure: 'Nothing new is measured here.',
      sentence: 'A restatement of the figures on this page.',
    },
  },
} as const satisfies Record<
  'model' | 'page',
  { title: string; metricFamily: 'generated' | 'summary'; claim: CardClaim }
>;

export function AIInsightCard({
  summary,
  author = 'model',
  insights = [],
  onViewReport,
}: AIInsightCardProps) {
  const { title, metricFamily, claim } = BY_AUTHOR[author];

  return (
    <AnalyticsCard
      title={title}
      icon={Sparkles}
      metricFamily={metricFamily}
      claim={claim}
      colSpan={2}
      footer={
        onViewReport && (
          <button
            type="button"
            onClick={onViewReport}
            className="flex items-center font-semibold text-primary hover:underline"
          >
            View full report
            <ArrowRight className="ml-1 size-4" />
          </button>
        )
      }
      data-test="overview-ai-insight"
    >
      <p className="text-sm leading-relaxed">{summary}</p>
      {insights.length > 0 && (
        <ul className="mt-3 space-y-1">
          {insights.map((insight, index) => (
            <li
              key={index}
              className="flex items-start text-xs text-muted-foreground"
            >
              {insight.type === 'success' ? (
                <CheckCircle className="mt-0.5 mr-1.5 size-4 shrink-0 text-primary" />
              ) : (
                <Lightbulb className="mt-0.5 mr-1.5 size-4 shrink-0 text-primary" />
              )}
              {insight.text}
            </li>
          ))}
        </ul>
      )}
    </AnalyticsCard>
  );
}
