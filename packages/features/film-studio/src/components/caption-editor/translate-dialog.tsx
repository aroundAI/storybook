'use client';

import { useState } from 'react';

import { useMutation } from '@tanstack/react-query';
import { Languages } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';

import { LANGUAGE_NAMES, getLanguageName } from '../../lib/caption-utils';
import { translateCaptionsAction } from '../../server/caption-actions';

interface TranslateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceCaptionId: string;
  sourceLanguage: string;
  existingLanguages: string[];
  onSuccess: () => void;
}

export function TranslateDialog({
  open,
  onOpenChange,
  sourceCaptionId,
  sourceLanguage,
  existingLanguages,
  onSuccess,
}: TranslateDialogProps) {
  const [targetLanguage, setTargetLanguage] = useState<string>('');

  // Filter out languages that already have captions
  const availableLanguages = Object.entries(LANGUAGE_NAMES).filter(
    ([code]) => !existingLanguages.includes(code) && code !== sourceLanguage,
  );

  const translateMutation = useMutation({
    mutationFn: translateCaptionsAction,
    onSuccess: () => {
      toast.success(
        `Captions translated to ${getLanguageName(targetLanguage)}`,
      );
      setTargetLanguage('');
      onSuccess();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to translate captions',
      );
    },
  });

  const handleTranslate = () => {
    if (!targetLanguage) {
      toast.error('Please select a target language');
      return;
    }

    translateMutation.mutate({
      sourceCaptionId,
      targetLanguage,
    });
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setTargetLanguage('');
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Languages className="h-5 w-5" />
            Translate Captions
          </DialogTitle>
          <DialogDescription>
            Translate {getLanguageName(sourceLanguage)} captions to another
            language using AI. The timing will be preserved from the source.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label
              htmlFor="target-language"
              className="text-sm font-medium leading-none"
            >
              Target Language
            </label>
            <Select value={targetLanguage} onValueChange={setTargetLanguage}>
              <SelectTrigger id="target-language">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {availableLanguages.length > 0 ? (
                  availableLanguages.map(([code, name]) => (
                    <SelectItem key={code} value={code}>
                      {name}
                    </SelectItem>
                  ))
                ) : (
                  <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                    All languages already have captions
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {existingLanguages.length > 1 && (
            <div className="text-muted-foreground text-xs">
              Already translated to:{' '}
              {existingLanguages
                .filter((code) => code !== sourceLanguage)
                .map((code) => getLanguageName(code))
                .join(', ')}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={translateMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleTranslate}
            disabled={
              !targetLanguage ||
              translateMutation.isPending ||
              availableLanguages.length === 0
            }
          >
            {translateMutation.isPending ? 'Translating...' : 'Translate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
