'use client';

import Link from 'next/link';

import {
  Check,
  ClipboardCopy,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { toast } from '@kit/ui/sonner';

import type { MappedFact } from '../../server/fact-row-mapper';
import { STATUS_LABELS, STATUS_STYLES, isReviewable } from './fact-constants';

interface FactCardProps {
  fact: MappedFact;
  basePath: string;
  onVerify?: () => void;
  onDelete?: () => void;
}

export function FactCard({
  fact,
  basePath,
  onVerify,
  onDelete,
}: FactCardProps) {
  const handleCopyClaim = async () => {
    try {
      await navigator.clipboard.writeText(fact.claim);
      toast.success('Claim copied to clipboard');
    } catch {
      toast.error('Failed to copy claim');
    }
  };

  return (
    <Card
      className="transition-shadow hover:shadow-md"
      data-test="fact-card"
      data-fact-id={fact.id}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left: claim, citation, tags */}
          <div className="min-w-0 flex-1">
            <Link
              href={`${basePath}/${fact.id}`}
              className="line-clamp-2 font-medium text-foreground hover:underline"
            >
              {fact.claim}
            </Link>

            {fact.sourceCitation && (
              <p className="mt-1.5 line-clamp-1 text-sm text-muted-foreground">
                {fact.sourceCitation}
              </p>
            )}

            {fact.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {fact.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Right: status, confidence, actions */}
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge
              data-test="fact-status"
              className={
                STATUS_STYLES[fact.verificationStatus] ??
                STATUS_STYLES.unverified
              }
            >
              {STATUS_LABELS[fact.verificationStatus] ??
                fact.verificationStatus}
            </Badge>

            {fact.confidenceScore != null && (
              <span className="text-xs text-muted-foreground">
                {Math.round(fact.confidenceScore * 100)}% confident
              </span>
            )}

            <span className="text-xs text-muted-foreground">
              Used {fact.timesUsed}×
            </span>
          </div>
        </div>

        {/* Actions row */}
        <div className="mt-3 flex items-center gap-1 border-t pt-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`${basePath}/${fact.id}`}>Details</Link>
          </Button>

          {isReviewable(fact.verificationStatus) && onVerify && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onVerify}
              data-test="fact-verify-button"
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              Verify
            </Button>
          )}

          {fact.sourceUrl && (
            <Button variant="ghost" size="sm" asChild>
              <a
                href={fact.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                Source
              </a>
            </Button>
          )}

          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  data-test="fact-actions-menu"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`${basePath}/${fact.id}`}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyClaim}>
                  <ClipboardCopy className="mr-2 h-4 w-4" />
                  Copy Claim
                </DropdownMenuItem>
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onDelete}
                      className="text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
