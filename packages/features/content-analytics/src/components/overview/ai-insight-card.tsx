'use client';

import { ArrowRight, CheckCircle, Lightbulb, Sparkles } from 'lucide-react';

import { AnalyticsCard } from './analytics-card';

interface AIInsightCardProps {
  /** Summary text with highlights */
  summary: string;
  /** Key insights/bullets */
  insights?: Array<{
    type: 'success' | 'opportunity';
    text: string;
  }>;
  /** Optional link to full report */
  onViewReport?: () => void;
}

export function AIInsightCard({
  summary,
  insights = [],
  onViewReport,
}: AIInsightCardProps) {
  return (
    <AnalyticsCard
      title="AI Performance Insight"
      icon={Sparkles}
      badge="New"
      variant="gradient"
      colSpan={2}
    >
      <div className="flex-1 overflow-hidden">
        <p
          className="text-sm leading-relaxed text-gray-900 dark:text-gray-100"
          dangerouslySetInnerHTML={{ __html: summary }}
        />
        {insights.length > 0 && (
          <ul className="mt-3 space-y-1">
            {insights.map((insight, index) => (
              <li
                key={index}
                className="flex items-start text-xs text-gray-700 dark:text-gray-300"
              >
                {insight.type === 'success' ? (
                  <CheckCircle className="mr-1.5 mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
                ) : (
                  <Lightbulb className="mr-1.5 mt-0.5 h-4 w-4 flex-shrink-0 text-orange-500" />
                )}
                {insight.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      {onViewReport && (
        <button
          onClick={onViewReport}
          className="mt-2 flex items-center text-xs font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          View full report
          <ArrowRight className="ml-1 h-4 w-4" />
        </button>
      )}
    </AnalyticsCard>
  );
}
