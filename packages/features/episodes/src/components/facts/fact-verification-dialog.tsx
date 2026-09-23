'use client';

import { useState, useTransition } from 'react';

import { AlertTriangle, Check, X } from 'lucide-react';

import { refusalMessage } from '@kit/next/action-result';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Label } from '@kit/ui/label';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

import type { MappedFact } from '../../server/fact-row-mapper';

type FactForVerification = Pick<
  MappedFact,
  'id' | 'claim' | 'sourceCitation' | 'sourceUrl'
>;

interface FactVerificationDialogProps {
  fact: FactForVerification;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerify: (factId: string, notes: string) => Promise<void>;
  onDispute: (factId: string, reason: string) => Promise<void>;
}

export function FactVerificationDialog({
  fact,
  open,
  onOpenChange,
  onVerify,
  onDispute,
}: FactVerificationDialogProps) {
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();

  // Closes only on success: a refusal leaves the dialog open with the notes
  // the user typed, and says why.
  function handleVerify() {
    startTransition(async () => {
      try {
        await onVerify(fact.id, notes);
        setNotes('');
        onOpenChange(false);
      } catch (error) {
        toast.error(
          refusalMessage(error, 'Could not verify the fact. Try again.'),
        );
      }
    });
  }

  function handleDispute() {
    if (!notes.trim()) return;

    startTransition(async () => {
      try {
        await onDispute(fact.id, notes);
        setNotes('');
        onOpenChange(false);
      } catch (error) {
        toast.error(
          refusalMessage(error, 'Could not dispute the fact. Try again.'),
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-test="fact-review-dialog">
        <DialogHeader>
          <DialogTitle>Verify Fact</DialogTitle>
          <DialogDescription>
            Review the claim and its source before confirming.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-sm font-medium">Claim</Label>
            <p
              className="mt-1 text-sm text-muted-foreground"
              data-test="fact-review-claim"
            >
              {fact.claim}
            </p>
          </div>

          <div>
            <Label className="text-sm font-medium">Source Citation</Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {fact.sourceCitation ?? 'None provided'}
            </p>
            {fact.sourceUrl && (
              <a
                href={fact.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-sm text-blue-500 hover:underline"
              >
                View Source →
              </a>
            )}
          </div>

          <div>
            <Label htmlFor="verification-notes">Notes</Label>
            <Textarea
              id="verification-notes"
              data-test="fact-review-notes"
              placeholder="Add verification notes or dispute reason..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button
            onClick={handleVerify}
            disabled={isPending}
            variant="default"
            data-test="fact-confirm-verified"
          >
            <Check className="mr-1.5 h-4 w-4" />
            Confirm Verified
          </Button>
          <Button
            variant="destructive"
            onClick={handleDispute}
            disabled={isPending || !notes.trim()}
            data-test="fact-mark-disputed"
          >
            <AlertTriangle className="mr-1.5 h-4 w-4" />
            Mark Disputed
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            <X className="mr-1.5 h-4 w-4" />
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
