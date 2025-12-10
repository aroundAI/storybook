'use client';

import type { ChangeEvent } from 'react';
import { useState } from 'react';

import { AlertCircle, Building2, Hash, User } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Textarea } from '@kit/ui/textarea';

import { LINKEDIN_CONSTRAINTS } from '../providers/linkedin';

interface LinkedInComposerProps {
  initialText?: string;
  isCompanyPage?: boolean;
  onSave: (text: string) => void;
  disabled?: boolean;
}

/**
 * LinkedIn post composer component
 * Provides character counting, hashtag tracking, and limit enforcement
 */
export function LinkedInComposer({
  initialText = '',
  isCompanyPage = false,
  onSave,
  disabled = false,
}: LinkedInComposerProps) {
  const [text, setText] = useState(initialText);

  const charCount = text.length;
  const isOverLimit = charCount > LINKEDIN_CONSTRAINTS.post.maxLength;
  const hashtagMatches = text.match(/#\w+/g) || [];
  const hashtagCount = hashtagMatches.length;
  const isOverHashtagLimit =
    hashtagCount > LINKEDIN_CONSTRAINTS.post.maxHashtags;

  const maxDuration = isCompanyPage
    ? LINKEDIN_CONSTRAINTS.video.company.maxDuration
    : LINKEDIN_CONSTRAINTS.video.personal.maxDuration;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Compose LinkedIn Post</CardTitle>
          <Badge variant="outline" className="flex items-center gap-1">
            {isCompanyPage ? (
              <>
                <Building2 className="h-3 w-3" />
                Company Page
              </>
            ) : (
              <>
                <User className="h-3 w-3" />
                Personal Profile
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={text}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
            setText(e.target.value)
          }
          placeholder="Share your professional insights..."
          rows={6}
          disabled={disabled}
          className={isOverLimit ? 'border-red-500' : ''}
        />

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Badge
              variant={isOverHashtagLimit ? 'destructive' : 'outline'}
              className="flex items-center gap-1"
            >
              <Hash className="h-3 w-3" />
              {hashtagCount}/{LINKEDIN_CONSTRAINTS.post.maxHashtags}
            </Badge>
            <Badge variant="secondary">
              Max video: {formatDuration(maxDuration)}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-sm ${
                isOverLimit ? 'text-red-500' : 'text-muted-foreground'
              }`}
            >
              {charCount}/{LINKEDIN_CONSTRAINTS.post.maxLength}
            </span>
            <Button
              onClick={() => onSave(text)}
              disabled={isOverLimit || isOverHashtagLimit || disabled}
            >
              Save
            </Button>
          </div>
        </div>

        {isOverLimit && (
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="h-4 w-4" />
            Post is too long. Please shorten to{' '}
            {LINKEDIN_CONSTRAINTS.post.maxLength} characters.
          </div>
        )}

        {isOverHashtagLimit && !isOverLimit && (
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="h-4 w-4" />
            Too many hashtags. Maximum is{' '}
            {LINKEDIN_CONSTRAINTS.post.maxHashtags}.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
