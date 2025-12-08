'use client';

import {
  BookOpen,
  CheckCircle,
  Film,
  Lightbulb,
  ListOrdered,
  Loader2,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Card, CardContent } from '@kit/ui/card';
import { Progress } from '@kit/ui/progress';
import { cn } from '@kit/ui/utils';

import type { StudioTab } from '../../lib/types';

interface PipelineProgressProps {
  currentStep: number;
  totalSteps: number;
  currentTab: StudioTab;
  isGenerating?: boolean;
}

const STEP_CONFIG: Array<{
  id: StudioTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'ideation', label: 'Ideation', icon: Lightbulb },
  { id: 'story', label: 'Story', icon: BookOpen },
  { id: 'screenplay', label: 'Screenplay', icon: Film },
  { id: 'shot-list', label: 'Shot List', icon: ListOrdered },
];

export function PipelineProgress({
  currentStep,
  totalSteps,
  currentTab,
  isGenerating = false,
}: PipelineProgressProps) {
  const progressPercentage = (currentStep / totalSteps) * 100;
  const currentTabIndex = STEP_CONFIG.findIndex((s) => s.id === currentTab);

  return (
    <Card>
      <CardContent className="py-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Pipeline Progress</span>
            <Badge variant={isGenerating ? 'default' : 'secondary'}>
              {currentStep}/{totalSteps}
            </Badge>
          </div>

          {isGenerating && (
            <div className="flex items-center gap-2 text-orange-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Generating...</span>
            </div>
          )}
        </div>

        <Progress
          value={progressPercentage}
          className={cn(isGenerating && 'animate-pulse')}
        />

        <div className="mt-3 flex justify-between">
          {STEP_CONFIG.map((step, index) => {
            const isCompleted = index < currentStep;
            const isCurrent = index === currentTabIndex;
            const StepIcon = step.icon;

            return (
              <div
                key={step.id}
                className={cn(
                  'flex flex-col items-center gap-1',
                  isCompleted && 'text-primary',
                  isCurrent && 'font-semibold',
                  !isCompleted && !isCurrent && 'text-muted-foreground',
                )}
              >
                <div className="flex h-6 w-6 items-center justify-center">
                  {isCompleted ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : isCurrent && isGenerating ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <StepIcon className="h-5 w-5" />
                  )}
                </div>
                <span className="text-xs">{step.label}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
