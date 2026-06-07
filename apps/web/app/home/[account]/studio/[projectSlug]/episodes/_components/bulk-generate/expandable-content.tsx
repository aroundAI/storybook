'use client';

import { useCallback, useState } from 'react';

import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

interface ExpandableContentProps {
  content: string;
  label: string;
  maxCollapsedLength?: number;
}

export function ExpandableContent({
  content,
  label,
  maxCollapsedLength = 200,
}: ExpandableContentProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const isLong = content.length > maxCollapsedLength;
  const displayText = isExpanded
    ? content
    : content.substring(0, maxCollapsedLength);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [content]);

  return (
    <div className="space-y-2">
      {/* Header with label + copy button */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 text-xs font-medium text-white/50 transition-colors hover:text-white/70"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {label}
        </button>

        <Button
          size="sm"
          variant="ghost"
          onClick={handleCopy}
          className="h-6 gap-1 px-2 text-xs text-white/40 hover:text-white/70"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </Button>
      </div>

      {/* Content */}
      <div
        className={cn(
          'text-sm leading-relaxed whitespace-pre-wrap text-white/60',
          isExpanded && 'max-h-[400px] overflow-y-auto pr-2',
        )}
      >
        {displayText}
        {!isExpanded && isLong && (
          <button
            onClick={() => setIsExpanded(true)}
            className="ml-1 text-blue-400/70 hover:text-blue-400"
          >
            …read more
          </button>
        )}
      </div>

      {/* Collapse button when expanded */}
      {isExpanded && isLong && (
        <button
          onClick={() => setIsExpanded(false)}
          className="text-xs text-white/40 transition-colors hover:text-white/60"
        >
          Show less
        </button>
      )}
    </div>
  );
}
