'use client';

import {
  Plus,
  Smartphone,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import type { ShortsGroup } from '@kit/episodes/types';
import type { SupportedLanguage } from '@kit/publishing/lib/constants';
import { LANG_INFO } from '@kit/publishing/lib/constants';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Input } from '@kit/ui/input';

interface ShortsSectionProps {
  shortsGroups: ShortsGroup[];
  onAddGroup: () => void;
  onUpdateGroupMetadata: (
    groupId: string,
    updates: Partial<Pick<ShortsGroup, 'title' | 'description' | 'tags' | 'name'>>,
  ) => void;
  onDeleteGroup: (groupId: string) => void;
  onDeleteVideoFromGroup: (groupId: string, language: string) => void;
  onOpenUploadDialog: (type: 'shorts', groupId: string) => void;
}

export function ShortsSection({
  shortsGroups,
  onAddGroup,
  onUpdateGroupMetadata,
  onDeleteGroup,
  onDeleteVideoFromGroup,
  onOpenUploadDialog,
}: ShortsSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Smartphone className="h-5 w-5 text-pink-500" />
            Shorts / Reels
            <Badge variant="outline" className="ml-2 text-xs">
              {shortsGroups.length} group
              {shortsGroups.length !== 1 ? 's' : ''}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onAddGroup}
              className="border-pink-300 text-pink-600 hover:bg-pink-50"
            >
              <Plus className="mr-1 h-4 w-4" />
              New Group
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {shortsGroups.length === 0 ? (
          <button
            onClick={onAddGroup}
            className="flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-gray-500 transition-colors hover:border-pink-400 hover:bg-pink-50 hover:text-pink-600 dark:border-gray-600 dark:bg-gray-800/50"
          >
            <Upload className="h-8 w-8" />
            <span className="font-medium">
              Create First Shorts Group
            </span>
            <span className="text-sm text-gray-400">
              Each group has its own metadata that gets translated
            </span>
          </button>
        ) : (
          shortsGroups.map((group, groupIndex) => (
            <div
              key={group.id}
              className="border-border overflow-hidden rounded-lg border"
            >
              {/* Group Header */}
              <div className="border-border border-b bg-gradient-to-r from-pink-50 to-purple-50 p-3 dark:from-pink-900/20 dark:to-purple-900/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-pink-600 dark:text-pink-400">
                      Group {groupIndex + 1}
                    </span>
                    <Input
                      value={group.name}
                      onChange={(e) =>
                        onUpdateGroupMetadata(group.id, {
                          name: e.target.value,
                        })
                      }
                      className="h-7 w-32 border-pink-200 text-xs"
                      placeholder="Group name"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteGroup(group.id)}
                    className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Group Metadata */}
              <div className="space-y-2 bg-gray-50/50 p-3 dark:bg-gray-800/30">
                <div>
                  <label className="text-xs font-medium text-gray-500">
                    Title
                  </label>
                  <Input
                    value={group.title}
                    onChange={(e) =>
                      onUpdateGroupMetadata(group.id, {
                        title: e.target.value,
                      })
                    }
                    className="h-8 text-sm"
                    placeholder="Title for this shorts group"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">
                    Description
                  </label>
                  <textarea
                    value={group.description}
                    onChange={(e) =>
                      onUpdateGroupMetadata(group.id, {
                        description: e.target.value,
                      })
                    }
                    className="border-border bg-card min-h-[60px] w-full rounded-md border p-2 text-sm"
                    placeholder="Description for this group (will be translated per language)"
                  />
                </div>
              </div>

              {/* Group Videos */}
              <div className="p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(group.videos).map(
                    ([lang, url]) =>
                      url && (
                        <div
                          key={lang}
                          className="border-border group/video relative overflow-hidden rounded-lg border"
                        >
                          <video
                            src={url}
                            className="aspect-[9/16] w-full bg-black object-cover"
                            controls
                          />
                          <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs text-white">
                            <span>
                              {
                                LANG_INFO[lang as SupportedLanguage]
                                  ?.flag
                              }
                            </span>
                            <span>
                              {
                                LANG_INFO[lang as SupportedLanguage]
                                  ?.name
                              }
                            </span>
                          </div>
                          {/* Delete video button */}
                          <button
                            onClick={() =>
                              onDeleteVideoFromGroup(group.id, lang)
                            }
                            className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-colors group-hover/video:opacity-100 hover:bg-red-600"
                            title={`Remove ${LANG_INFO[lang as SupportedLanguage]?.name || lang} video`}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ),
                  )}
                  <button
                    onClick={() =>
                      onOpenUploadDialog('shorts', group.id)
                    }
                    className="flex aspect-[9/16] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 text-gray-500 transition-colors hover:border-pink-400 hover:bg-pink-50 hover:text-pink-600 dark:border-gray-600 dark:bg-gray-800/50 dark:hover:border-pink-500 dark:hover:bg-gray-700/50 dark:hover:text-pink-400"
                  >
                    <Plus className="h-6 w-6" />
                    <span className="text-sm font-medium">
                      Add Language
                    </span>
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
