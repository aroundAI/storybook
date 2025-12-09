'use client';

import { CheckCircle, Eye, Sparkles } from 'lucide-react';

import type { StoryIdea } from '@kit/prompt-engine/schemas';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

interface IdeaCardProps {
  idea: StoryIdea;
  isSelected: boolean;
  onSelect: () => void;
}

export function IdeaCard({ idea, isSelected, onSelect }: IdeaCardProps) {
  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-md',
        isSelected && 'ring-primary ring-2',
      )}
      onClick={onSelect}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg">{idea.title}</CardTitle>
          {isSelected && <CheckCircle className="h-5 w-5 text-green-500" />}
        </div>
        <CardDescription className="line-clamp-2">
          {idea.logline}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-muted-foreground mb-1 flex items-center gap-1 text-xs font-medium">
            <Sparkles className="h-3 w-3" />
            Themes
          </div>
          <div className="flex flex-wrap gap-1">
            {idea.themes.slice(0, 3).map((theme, index) => (
              <Badge key={index} variant="secondary" className="text-xs">
                {theme}
              </Badge>
            ))}
            {idea.themes.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{idea.themes.length - 3}
              </Badge>
            )}
          </div>
        </div>

        <div>
          <div className="text-muted-foreground mb-1 text-xs font-medium">
            Hook
          </div>
          <p className="line-clamp-2 text-sm">{idea.hook}</p>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="text-muted-foreground flex items-center gap-1 text-xs">
            <Eye className="h-3 w-3" />
            <span>Visual Potential: {idea.visualPotential}</span>
          </div>
          <Button
            size="sm"
            variant={isSelected ? 'default' : 'outline'}
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
          >
            {isSelected ? 'Selected' : 'Select'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
