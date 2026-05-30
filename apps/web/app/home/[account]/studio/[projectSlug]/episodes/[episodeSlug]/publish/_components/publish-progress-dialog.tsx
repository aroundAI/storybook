'use client';

import {
  AlertCircle,
  Check,
  Clock,
  ExternalLink,
  Loader2,
  Smartphone,
  Upload,
  X,
} from 'lucide-react';

import type { SupportedLanguage } from '@kit/publishing/lib/constants';
import { LANG_INFO } from '@kit/publishing/lib/constants';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import { PlatformIcon } from './platform-ui';
import type {
  PlatformUploadStatus,
  PublishStage,
  TranslationResult,
} from './publish-types';

interface PublishProgressDialogProps {
  publishStage: PublishStage;
  translationResults: TranslationResult[];
  platformStatuses: PlatformUploadStatus[];
  publishError: string | null;
  onCancel: () => void;
  onConfirmUpload: () => void;
}

export function PublishProgressDialog({
  publishStage,
  translationResults,
  platformStatuses,
  publishError,
  onCancel,
  onConfirmUpload,
}: PublishProgressDialogProps) {
  return (
    <Dialog
      open={publishStage !== 'idle'}
      onOpenChange={(open) => !open && onCancel()}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {publishStage === 'translating' && (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                Translating Metadata...
              </>
            )}
            {publishStage === 'confirm-translation' && (
              <>
                <Check className="h-5 w-5 text-green-500" />
                Confirm Translations
              </>
            )}
            {publishStage === 'uploading' && (
              <>
                <Upload className="h-5 w-5 animate-pulse text-indigo-500" />
                Publishing to Platforms...
              </>
            )}
            {publishStage === 'complete' && (
              <>
                <Check className="h-5 w-5 text-green-500" />
                Publishing Complete!
              </>
            )}
            {publishStage === 'error' && (
              <>
                <AlertCircle className="h-5 w-5 text-red-500" />
                Publishing Failed
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Translation Stage */}
          {(publishStage === 'translating' ||
            publishStage === 'confirm-translation') && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                {publishStage === 'translating'
                  ? 'Translating titles and descriptions for each language...'
                  : 'Review the translated metadata before publishing:'}
              </p>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                {translationResults.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-start gap-3 rounded-md bg-gray-50 p-2 dark:bg-gray-800"
                  >
                    <span className="text-xl">
                      {LANG_INFO[t.language as SupportedLanguage]?.flag || '🌐'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {t.contentName}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {LANG_INFO[t.language as SupportedLanguage]?.name ||
                            t.language}
                        </Badge>
                        {t.contentType === 'shorts-group' && (
                          <Badge variant="secondary" className="text-[10px]">
                            <Smartphone className="mr-0.5 h-2.5 w-2.5" />
                            Short
                          </Badge>
                        )}
                        {t.status === 'pending' && (
                          <span className="text-xs text-gray-400">Pending</span>
                        )}
                        {t.status === 'translating' && (
                          <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
                        )}
                        {t.status === 'success' && (
                          <Check className="h-3 w-3 text-green-500" />
                        )}
                        {t.status === 'error' && (
                          <X className="h-3 w-3 text-red-500" />
                        )}
                      </div>
                      {t.status === 'success' && t.title && (
                        <p className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-400">
                          {t.title}
                        </p>
                      )}
                      {t.error && (
                        <p className="mt-0.5 text-xs text-red-500">{t.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Uploading Stage */}
          {(publishStage === 'uploading' || publishStage === 'complete') && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                {publishStage === 'uploading'
                  ? 'Uploading videos to each platform...'
                  : 'All uploads completed:'}
              </p>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                {platformStatuses.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-md bg-gray-50 p-2 dark:bg-gray-800"
                  >
                    <PlatformIcon platform={s.platform} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {s.connectionName}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {s.contentType === 'short' ? 'Short' : 'Full'}
                        </Badge>
                        <span className="text-xs">
                          {LANG_INFO[s.language as SupportedLanguage]?.flag}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.status === 'pending' && (
                        <Clock className="h-4 w-4 text-gray-400" />
                      )}
                      {s.status === 'uploading' && (
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                      )}
                      {s.status === 'success' && (
                        <>
                          <Check className="h-4 w-4 text-green-500" />
                          {s.url && (
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-500 hover:text-indigo-600"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </>
                      )}
                      {s.status === 'error' && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <X className="h-4 w-4 text-red-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-xs">{s.error}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error Stage */}
          {publishStage === 'error' && publishError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
              <p className="text-sm text-red-700 dark:text-red-400">
                {publishError}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-2">
            {publishStage === 'confirm-translation' && (
              <>
                <Button variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
                <Button
                  onClick={onConfirmUpload}
                  className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Confirm & Publish
                </Button>
              </>
            )}
            {(publishStage === 'complete' || publishStage === 'error') && (
              <Button onClick={onCancel}>
                {publishStage === 'complete' ? 'Done' : 'Close'}
              </Button>
            )}
            {(publishStage === 'translating' ||
              publishStage === 'uploading') && (
              <Button variant="outline" disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Please wait...
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
