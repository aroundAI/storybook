'use client';

import { useState } from 'react';

import {
  AlertCircle,
  Check,
  Copy,
  Hash,
  Linkedin,
  Type,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Textarea } from '@kit/ui/textarea';

import { LINKEDIN_CONSTRAINTS } from '../../providers/linkedin/types';

interface PostVariant {
  text: string;
  style: string;
  hashtags: string[];
  hookPreview: string;
  estimatedCharCount?: number;
}

interface VariantSelectorProps {
  variants: PostVariant[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onEditText: (text: string) => void;
  finalText: string;
  disabled?: boolean;
}

export function VariantSelector({
  variants,
  selectedIndex,
  onSelect,
  onEditText,
  finalText,
  disabled = false,
}: VariantSelectorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const charCount = finalText.length;
  const isOverLimit = charCount > LINKEDIN_CONSTRAINTS.post.maxLength;
  const hashtagMatches = finalText.match(/#\w+/g) || [];
  const hashtagCount = hashtagMatches.length;

  const handleCopy = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (variants.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Type className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
          <p className="text-muted-foreground text-sm">
            No variants generated yet. Paste your notes above and click
            &quot;Generate&quot;.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Variant tabs */}
      <div className="flex gap-2">
        {variants.map((variant, index) => (
          <Button
            key={index}
            variant={selectedIndex === index ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              onSelect(index);
              setIsEditing(false);
            }}
            disabled={disabled}
            className="flex items-center gap-1.5"
          >
            {selectedIndex === index && <Check className="h-3 w-3" />}
            <span className="font-medium">{variant.style}</span>
          </Button>
        ))}
      </div>

      {/* Selected variant preview/edit */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Linkedin className="h-4 w-4 text-[#0A66C2]" />
              Post Preview
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopy(finalText, selectedIndex)}
                disabled={disabled}
              >
                {copiedIndex === selectedIndex ? (
                  <Check className="mr-1 h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="mr-1 h-3 w-3" />
                )}
                {copiedIndex === selectedIndex ? 'Copied' : 'Copy'}
              </Button>
              <Button
                variant={isEditing ? 'default' : 'outline'}
                size="sm"
                onClick={() => setIsEditing(!isEditing)}
                disabled={disabled}
              >
                {isEditing ? 'Preview' : 'Edit'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Hook preview */}
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
            <p className="mb-1 text-xs font-medium text-blue-600 dark:text-blue-400">
              Hook (visible before &quot;See more&quot;):
            </p>
            <p className="text-sm">
              {finalText.substring(0, LINKEDIN_CONSTRAINTS.post.hookMaxLength)}
              {finalText.length > LINKEDIN_CONSTRAINTS.post.hookMaxLength && (
                <span className="text-muted-foreground">... See more</span>
              )}
            </p>
          </div>

          {/* Full post */}
          {isEditing ? (
            <Textarea
              value={finalText}
              onChange={(e) => onEditText(e.target.value)}
              rows={12}
              disabled={disabled}
              className={`resize-y font-mono text-sm ${isOverLimit ? 'border-red-500' : ''}`}
            />
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-md border bg-white p-4 dark:bg-zinc-950">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                {finalText}
              </pre>
            </div>
          )}

          {/* Metadata bar */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Badge
                variant={
                  hashtagCount > LINKEDIN_CONSTRAINTS.post.maxHashtags
                    ? 'destructive'
                    : 'outline'
                }
                className="flex items-center gap-1"
              >
                <Hash className="h-3 w-3" />
                {hashtagCount}/{LINKEDIN_CONSTRAINTS.post.maxHashtags}
              </Badge>
              <Badge variant="secondary">
                {variants[selectedIndex]?.style}
              </Badge>
            </div>

            <span
              className={`text-sm font-medium ${
                isOverLimit ? 'text-red-500' : 'text-muted-foreground'
              }`}
            >
              {charCount.toLocaleString()}/
              {LINKEDIN_CONSTRAINTS.post.maxLength.toLocaleString()}
            </span>
          </div>

          {isOverLimit && (
            <div className="flex items-center gap-2 text-sm text-red-500">
              <AlertCircle className="h-4 w-4" />
              Post exceeds the {LINKEDIN_CONSTRAINTS.post.maxLength} character
              limit.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
