'use client';

import { useState, useTransition } from 'react';

import {
    AlertTriangle,
    Check,
    X,
} from 'lucide-react';

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
import { Textarea } from '@kit/ui/textarea';

interface FactForVerification {
    id: string;
    claim: string;
    sourceCitation: string | null;
    sourceUrl: string | null;
}

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

    function handleVerify() {
        startTransition(async () => {
            await onVerify(fact.id, notes);
            setNotes('');
            onOpenChange(false);
        });
    }

    function handleDispute() {
        if (!notes.trim()) return;

        startTransition(async () => {
            await onDispute(fact.id, notes);
            setNotes('');
            onOpenChange(false);
        });
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Verify Fact</DialogTitle>
                    <DialogDescription>
                        Review the claim and its source before confirming.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div>
                        <Label className="text-sm font-medium">Claim</Label>
                        <p className="text-sm text-muted-foreground mt-1">
                            {fact.claim}
                        </p>
                    </div>

                    <div>
                        <Label className="text-sm font-medium">Source Citation</Label>
                        <p className="text-sm text-muted-foreground mt-1">
                            {fact.sourceCitation ?? 'None provided'}
                        </p>
                        {fact.sourceUrl && (
                            <a
                                href={fact.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-500 hover:underline mt-1 inline-block"
                            >
                                View Source →
                            </a>
                        )}
                    </div>

                    <div>
                        <Label htmlFor="verification-notes">Notes</Label>
                        <Textarea
                            id="verification-notes"
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
                        className="bg-green-600 hover:bg-green-700 text-white"
                    >
                        <Check className="h-4 w-4 mr-1.5" />
                        Confirm Verified
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={handleDispute}
                        disabled={isPending || !notes.trim()}
                    >
                        <AlertTriangle className="h-4 w-4 mr-1.5" />
                        Mark Disputed
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isPending}
                    >
                        <X className="h-4 w-4 mr-1.5" />
                        Cancel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
